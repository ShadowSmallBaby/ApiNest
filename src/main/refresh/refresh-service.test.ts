import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { runMigrations } from '../storage/run-migrations';
import { AccountRepository } from '../storage/repositories/account-repository';
import { AccountAuthStateRepository } from '../storage/repositories/account-auth-state-repository';
import { SnapshotRepository } from '../storage/repositories/snapshot-repository';
import { OperationRepository } from '../storage/repositories/operation-repository';
import type {
  NewApiQueriesClient,
  NewApiQueryResult,
} from '../adapters/newapi/newapi-queries-client';
import { RefreshService } from './refresh-service';

type QueriesClientPort = Pick<NewApiQueriesClient, 'query'>;

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';

describe('RefreshService', () => {
  function createHarness(
    queriesClient: QueriesClientPort,
    siteUserId: string | null = '42',
  ): {
    service: RefreshService;
    snapshotRepository: SnapshotRepository;
    operationRepository: OperationRepository;
    cleanup: () => void;
  } {
    const directory = mkdtempSync(join(tmpdir(), 'apinest-refresh-'));
    const filePath = join(directory, 'refresh.db');
    const database = new Database(filePath);
    runMigrations(database);

    const accountRepository = new AccountRepository(database);
    const authStateRepository = new AccountAuthStateRepository(database);
    const snapshotRepository = new SnapshotRepository(database);
    const operationRepository = new OperationRepository(database);

    const now = new Date().toISOString();
    accountRepository.create({
      id: ACCOUNT_ID,
      platform: 'newapi',
      baseUrl: 'https://example.com',
      displayName: 'Account A',
      recordVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    // 预置站内用户 ID（New-Api-User 头必需）；null 用于测试缺失分支。
    if (siteUserId !== null) {
      authStateRepository.upsertSiteIdentity(ACCOUNT_ID, siteUserId, now);
    }

    return {
      service: new RefreshService({
        queriesClient,
        snapshotRepository,
        operationRepository,
        accountRepository,
        authStateRepository,
      }),
      snapshotRepository,
      operationRepository,
      cleanup: () => {
        database.close();
        rmSync(directory, { recursive: true, force: true });
      },
    };
  }

  it('writes latest snapshots and records a success operation', async () => {
    const result: NewApiQueryResult = {
      profile: { username: 'alice', source: 'newapi:/api/user/self' },
      balance: { remaining: 500, unit: 'quota', source: 'newapi:/api/user/self' },
      usage: { used: 120, unit: 'quota', source: 'newapi:/api/user/self' },
    };
    const { service, snapshotRepository, operationRepository, cleanup } = createHarness({
      query: async () => result,
    });

    try {
      await service.refresh(ACCOUNT_ID);

      const snapshots = snapshotRepository.getLatest(ACCOUNT_ID);
      expect(snapshots.map(s => s.kind).sort()).toEqual(['balance', 'profile', 'usage']);

      const operations = operationRepository.listRecent(ACCOUNT_ID);
      expect(operations).toHaveLength(1);
      expect(operations[0].status).toBe('success');
    } finally {
      cleanup();
    }
  });

  it('passes the resolved site user id to the queries client', async () => {
    let capturedSiteUserId: string | undefined;
    const { service, cleanup } = createHarness({
      query: async request => {
        capturedSiteUserId = request.siteUserId;
        return { profile: null, balance: null, usage: null };
      },
    });

    try {
      await service.refresh(ACCOUNT_ID);
      expect(capturedSiteUserId).toBe('42');
    } finally {
      cleanup();
    }
  });

  it('does NOT overwrite the last successful snapshot when the request fails', async () => {
    let mode: 'success' | 'fail' = 'success';
    const { service, snapshotRepository, operationRepository, cleanup } = createHarness({
      query: async () => {
        if (mode === 'fail') {
          throw new Error('network down');
        }
        return {
          profile: { username: 'alice', source: 'newapi:/api/user/self' },
          balance: { remaining: 500, unit: 'quota', source: 'newapi:/api/user/self' },
          usage: { used: 120, unit: 'quota', source: 'newapi:/api/user/self' },
        };
      },
    });

    try {
      await service.refresh(ACCOUNT_ID);
      const before = snapshotRepository.getLatest(ACCOUNT_ID);
      const balanceBefore = before.find(s => s.kind === 'balance');
      expect(balanceBefore).toBeDefined();

      // 第二次刷新失败：旧快照必须保持不变。
      mode = 'fail';
      const failResult = await service.refresh(ACCOUNT_ID);

      const after = snapshotRepository.getLatest(ACCOUNT_ID);
      const balanceAfter = after.find(s => s.kind === 'balance');

      expect(after).toHaveLength(before.length);
      expect(balanceAfter?.id).toBe(balanceBefore?.id);
      expect(balanceAfter?.fetchedAt).toBe(balanceBefore?.fetchedAt);
      expect(balanceAfter?.payloadJson).toBe(balanceBefore?.payloadJson);

      const operations = operationRepository.listRecent(ACCOUNT_ID);
      const errorOp = operations.find(op => op.status === 'error');
      expect(errorOp?.errorCode).toBe('NETWORK_ERROR');
      // 错误摘要脱敏，不含原始异常细节。
      expect(errorOp?.errorSummary).not.toContain('network down');
      expect(failResult.authState).toBe('unknown');
    } finally {
      cleanup();
    }
  });

  it('does NOT write a snapshot for a field parsed as null (never fabricates 0)', async () => {
    const { service, snapshotRepository, cleanup } = createHarness({
      query: async () => ({
        profile: { username: 'alice', source: 'newapi:/api/user/self' },
        balance: null, // 本项不可用
        usage: null,
      }),
    });

    try {
      await service.refresh(ACCOUNT_ID);

      const snapshots = snapshotRepository.getLatest(ACCOUNT_ID);
      expect(snapshots.map(s => s.kind)).toEqual(['profile']);
      // balance/usage 没有被写成 0 值快照。
      expect(snapshots.find(s => s.kind === 'balance')).toBeUndefined();
      expect(snapshots.find(s => s.kind === 'usage')).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it('records AUTH_METADATA_REQUIRED and skips the query when site user id is missing', async () => {
    let queried = false;
    const { service, snapshotRepository, operationRepository, cleanup } = createHarness(
      {
        query: async () => {
          queried = true;
          return { profile: null, balance: null, usage: null };
        },
      },
      null,
    );

    try {
      const result = await service.refresh(ACCOUNT_ID);
      expect(queried).toBe(false);
      expect(snapshotRepository.getLatest(ACCOUNT_ID)).toHaveLength(0);

      const operations = operationRepository.listRecent(ACCOUNT_ID);
      expect(operations[0].status).toBe('error');
      expect(operations[0].errorCode).toBe('AUTH_METADATA_REQUIRED');
      expect(result.authState).toBe('unknown');
    } finally {
      cleanup();
    }
  });

  it('throws ACCOUNT_NOT_FOUND for unknown account', async () => {
    const { service, cleanup } = createHarness({
      query: async () => ({ profile: null, balance: null, usage: null }),
    });

    try {
      await expect(service.refresh('99999999-9999-4999-8999-999999999999')).rejects.toMatchObject({
        code: 'ACCOUNT_NOT_FOUND',
      });
    } finally {
      cleanup();
    }
  });
});
