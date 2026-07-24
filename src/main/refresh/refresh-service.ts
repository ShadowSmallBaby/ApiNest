import { randomUUID } from 'node:crypto';
import { AppError } from '../../shared/ipc/errors';
import type { RefreshResult } from '../../shared/ipc/bridge';
import type { AccountRepository } from '../storage/repositories/account-repository';
import type {
  SnapshotEntity,
  SnapshotKind,
  SnapshotRepository,
} from '../storage/repositories/snapshot-repository';
import type { OperationRepository } from '../storage/repositories/operation-repository';
import type { AccountAuthStateRepository } from '../storage/repositories/account-auth-state-repository';
import type {
  NewApiQueriesClient,
  NewApiQueryResult,
} from '../adapters/newapi/newapi-queries-client';
import type { NewApiStatusClient } from '../adapters/newapi/newapi-status-client';

type AccountRepositoryPort = Pick<AccountRepository, 'get'>;
type AuthStateRepositoryPort = Pick<AccountAuthStateRepository, 'getSiteUserId'>;
type SnapshotRepositoryPort = Pick<SnapshotRepository, 'upsertLatest'>;
type OperationRepositoryPort = Pick<OperationRepository, 'record'>;
type QueriesClientPort = Pick<NewApiQueriesClient, 'query'>;
type StatusClientPort = Pick<NewApiStatusClient, 'fetchStatus'>;

const REFRESH_OPERATION_KIND = 'refresh';

export interface RefreshServiceDependencies {
  queriesClient: QueriesClientPort;
  statusClient: StatusClientPort;
  snapshotRepository: SnapshotRepositoryPort;
  operationRepository: OperationRepositoryPort;
  accountRepository: AccountRepositoryPort;
  authStateRepository: AuthStateRepositoryPort;
  now?: () => string;
}

/**
 * 用户侧刷新编排。
 *
 * 红线：
 * - 查询失败（网络/请求异常）记 error 操作，绝不覆盖最近成功快照；
 * - 单项解析为 null（本项不可用）时不写该 kind 快照，保留旧值，绝不伪造 0；
 * - 成功解析的项写最新快照。
 */
export class RefreshService {
  private readonly queriesClient: QueriesClientPort;
  private readonly statusClient: StatusClientPort;
  private readonly snapshotRepository: SnapshotRepositoryPort;
  private readonly operationRepository: OperationRepositoryPort;
  private readonly accountRepository: AccountRepositoryPort;
  private readonly authStateRepository: AuthStateRepositoryPort;
  private readonly now: () => string;

  constructor(dependencies: RefreshServiceDependencies) {
    this.queriesClient = dependencies.queriesClient;
    this.statusClient = dependencies.statusClient;
    this.snapshotRepository = dependencies.snapshotRepository;
    this.operationRepository = dependencies.operationRepository;
    this.accountRepository = dependencies.accountRepository;
    this.authStateRepository = dependencies.authStateRepository;
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  async refresh(accountId: string): Promise<RefreshResult> {
    const account = this.accountRepository.get(accountId);
    if (!account) {
      throw new AppError('ACCOUNT_NOT_FOUND', 'Account was not found.');
    }

    const startedAt = this.now();

    // 站内用户 ID 为 New-Api-User 头必需；缺失则记 error 操作、保留旧快照、不发无谓请求。
    const siteUserId = this.authStateRepository.getSiteUserId(accountId);
    if (!siteUserId) {
      this.operationRepository.record({
        id: randomUUID(),
        accountId,
        kind: REFRESH_OPERATION_KIND,
        status: 'error',
        startedAt,
        finishedAt: this.now(),
        errorCode: 'AUTH_METADATA_REQUIRED',
        errorSummary: 'Site user identity is required. Please sign in again.',
      });
      return {
        accountId,
        authState: 'unknown',
        message: 'Refresh failed. Please sign in again to sync account identity.',
      };
    }

    let result: NewApiQueryResult;
    let quotaPerUnit: number;
    try {
      // 并发执行用户数据查询与站点状态查询（汇率除数）
      const [queryResult, statusResult] = await Promise.all([
        this.queriesClient.query({
          accountId,
          baseUrl: account.baseUrl,
          siteUserId,
        }),
        this.statusClient.fetchStatus(account.baseUrl),
      ]);
      result = queryResult;
      quotaPerUnit = statusResult.quotaPerUnit; // 已 fallback 到 500000
    } catch {
      // 网络/请求异常：记 error 操作，绝不覆盖任何旧快照，绝不伪造业务数据。
      this.operationRepository.record({
        id: randomUUID(),
        accountId,
        kind: REFRESH_OPERATION_KIND,
        status: 'error',
        startedAt,
        finishedAt: this.now(),
        errorCode: 'NETWORK_ERROR',
        errorSummary: 'Refresh request failed.',
      });

      return {
        accountId,
        authState: 'unknown',
        message: 'Refresh failed. Showing last cached data if available.',
      };
    }

    // 成功解析的项写最新快照；解析为 null 的项保留旧快照，不写、不填 0。
    let wroteAny = false;

    if (result.profile) {
      this.writeSnapshot(accountId, 'profile', result.profile, undefined);
      wroteAny = true;
    }
    if (result.balance) {
      this.writeSnapshot(accountId, 'balance', { ...result.balance, quotaPerUnit }, result.balance.unit);
      wroteAny = true;
    }
    if (result.usage) {
      this.writeSnapshot(accountId, 'usage', { ...result.usage, quotaPerUnit }, result.usage.unit);
      wroteAny = true;
    }

    this.operationRepository.record({
      id: randomUUID(),
      accountId,
      kind: REFRESH_OPERATION_KIND,
      status: 'success',
      startedAt,
      finishedAt: this.now(),
    });

    return {
      accountId,
      authState: 'unknown',
      message: wroteAny
        ? 'Refresh completed.'
        : 'Refresh completed, but no user-side data was available.',
    };
  }

  private writeSnapshot(
    accountId: string,
    kind: SnapshotKind,
    payload: object,
    semanticUnit: string | undefined,
  ): void {
    const entity: SnapshotEntity = {
      id: randomUUID(),
      accountId,
      kind,
      payloadJson: JSON.stringify(payload),
      semanticUnit,
      fetchedAt: this.now(),
      isLatest: true,
    };

    this.snapshotRepository.upsertLatest(entity);
  }
}
