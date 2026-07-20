import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { runMigrations } from '../run-migrations';
import { AccountRepository } from './account-repository';
import { AccountAuthStateRepository } from './account-auth-state-repository';

describe('AccountAuthStateRepository', () => {
  function createRepositories(): {
    accountRepository: AccountRepository;
    authStateRepository: AccountAuthStateRepository;
    database: Database.Database;
    cleanup: () => void;
  } {
    const directory = mkdtempSync(join(tmpdir(), 'apinest-auth-state-'));
    const filePath = join(directory, 'auth-state.db');
    const database = new Database(filePath);
    runMigrations(database);

    return {
      accountRepository: new AccountRepository(database),
      authStateRepository: new AccountAuthStateRepository(database),
      database,
      cleanup: () => {
        database.close();
        rmSync(directory, { recursive: true, force: true });
      },
    };
  }

  function seedAccount(accountRepository: AccountRepository, id: string, displayName: string): void {
    const now = new Date().toISOString();
    accountRepository.create({
      id,
      platform: 'newapi',
      baseUrl: 'https://example.com',
      displayName,
      recordVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
  }

  const idA = '11111111-1111-4111-8111-111111111111';
  const idB = '22222222-2222-4222-8222-222222222222';

  it('upserts and reads state, clearing error fields on success', () => {
    const { accountRepository, authStateRepository, cleanup } = createRepositories();

    try {
      seedAccount(accountRepository, idA, 'Account A');

      authStateRepository.upsert({
        accountId: idA,
        state: 'error',
        lastErrorCode: 'SESSION_CHECK_FAILED',
        lastErrorSummary: 'validation failed',
      });
      expect(authStateRepository.get(idA)?.state).toBe('error');

      authStateRepository.upsert({
        accountId: idA,
        state: 'active',
        lastVerifiedAt: '2026-07-13T00:00:00.000Z',
      });

      const state = authStateRepository.get(idA);
      expect(state?.state).toBe('active');
      expect(state?.lastVerifiedAt).toBe('2026-07-13T00:00:00.000Z');
      expect(state?.lastErrorCode).toBeUndefined();
      expect(state?.lastErrorSummary).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it('keeps auth state independent per account', () => {
    const { accountRepository, authStateRepository, cleanup } = createRepositories();

    try {
      seedAccount(accountRepository, idA, 'Account A');
      seedAccount(accountRepository, idB, 'Account B');

      authStateRepository.upsert({ accountId: idA, state: 'expired' });
      authStateRepository.upsert({ accountId: idB, state: 'active', lastVerifiedAt: '2026-07-13T00:00:00.000Z' });

      const states = authStateRepository.getMany([idA, idB]);
      expect(states.get(idA)?.state).toBe('expired');
      expect(states.get(idB)?.state).toBe('active');
    } finally {
      cleanup();
    }
  });

  it('cascades deletion when the account is removed', () => {
    const { accountRepository, authStateRepository, cleanup } = createRepositories();

    try {
      seedAccount(accountRepository, idA, 'Account A');
      authStateRepository.upsert({ accountId: idA, state: 'active' });

      accountRepository.delete(idA);

      expect(authStateRepository.get(idA)).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('returns an empty map for no account ids', () => {
    const { authStateRepository, cleanup } = createRepositories();

    try {
      expect(authStateRepository.getMany([]).size).toBe(0);
    } finally {
      cleanup();
    }
  });

  it('stores and reads the site user id, and updating state never clears it', () => {
    const { accountRepository, authStateRepository, cleanup } = createRepositories();

    try {
      seedAccount(accountRepository, idA, 'Account A');

      // 首次仅有身份：创建 unknown 行。
      authStateRepository.upsertSiteIdentity(idA, '42', '2026-07-20T00:00:00.000Z');
      expect(authStateRepository.getSiteUserId(idA)).toBe('42');
      expect(authStateRepository.get(idA)?.state).toBe('unknown');

      // 更新会话状态不应清除已存的 site user id。
      authStateRepository.upsert({ accountId: idA, state: 'active', lastVerifiedAt: '2026-07-20T01:00:00.000Z' });
      expect(authStateRepository.getSiteUserId(idA)).toBe('42');
      expect(authStateRepository.get(idA)?.state).toBe('active');

      // 再次写身份只更新身份列，不覆盖 state。
      authStateRepository.upsertSiteIdentity(idA, '99', '2026-07-20T02:00:00.000Z');
      expect(authStateRepository.getSiteUserId(idA)).toBe('99');
      expect(authStateRepository.get(idA)?.state).toBe('active');
    } finally {
      cleanup();
    }
  });

  it('clears the site identity without deleting the state row', () => {
    const { accountRepository, authStateRepository, cleanup } = createRepositories();

    try {
      seedAccount(accountRepository, idA, 'Account A');
      authStateRepository.upsert({ accountId: idA, state: 'active' });
      authStateRepository.upsertSiteIdentity(idA, '42', '2026-07-20T00:00:00.000Z');

      authStateRepository.clearSiteIdentity(idA);

      expect(authStateRepository.getSiteUserId(idA)).toBeNull();
      expect(authStateRepository.get(idA)?.state).toBe('active');
    } finally {
      cleanup();
    }
  });

  it('returns null site user id for an unknown account', () => {
    const { authStateRepository, cleanup } = createRepositories();

    try {
      expect(authStateRepository.getSiteUserId(idA)).toBeNull();
    } finally {
      cleanup();
    }
  });
});
