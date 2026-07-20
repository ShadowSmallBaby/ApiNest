import { randomUUID } from 'node:crypto';
import { AppError } from '../../shared/ipc/errors';
import type { CheckInResult, PlatformType } from '../../shared/ipc/bridge';
import type {
  AccountRequestContext,
  PlatformAdapter,
} from '../../shared/domain/platform-adapter';
import type { AdapterRegistry } from '../adapters/adapter-registry';
import { getAccountPartition } from '../auth/account-partition';
import type { AccountRepository } from '../storage/repositories/account-repository';
import type { AccountAuthStateRepository } from '../storage/repositories/account-auth-state-repository';
import type { CheckInResultRepository } from '../storage/repositories/checkin-result-repository';
import type { OperationRepository } from '../storage/repositories/operation-repository';

type AccountRepositoryPort = Pick<AccountRepository, 'get'>;
type AuthStateRepositoryPort = Pick<AccountAuthStateRepository, 'getSiteUserId'>;
type AdapterRegistryPort = Pick<AdapterRegistry, 'get'>;
type OperationRepositoryPort = Pick<OperationRepository, 'record'>;
type CheckInResultRepositoryPort = Pick<CheckInResultRepository, 'record'>;

export interface CheckInServiceDependencies {
  accountRepository: AccountRepositoryPort;
  authStateRepository: AuthStateRepositoryPort;
  adapterRegistry: AdapterRegistryPort;
  operationRepository: OperationRepositoryPort;
  checkInResultRepository: CheckInResultRepositoryPort;
  now?: () => string;
}

function messageForResult(result: CheckInResult['result']): string {
  switch (result) {
    case 'success':
      return 'Check-in completed.';
    case 'already_checked_in':
      return 'Already checked in for the current period.';
    case 'session_expired':
      return 'The account session has expired.';
    case 'challenge_required':
      return 'Human verification is required. Open the site page to complete the challenge, then retry.';
    case 'unsupported':
      return 'Check-in is not supported for this platform.';
    case 'cancelled':
      return 'Check-in was cancelled.';
    case 'failed':
      return 'Check-in request failed.';
  }
}

/** 用户明确触发的一次单账户签到；不重试、不调度、不伪造成功结果。 */
export class CheckInService {
  private readonly now: () => string;

  constructor(private readonly deps: CheckInServiceDependencies) {
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  async run(accountId: string): Promise<CheckInResult> {
    const account = this.deps.accountRepository.get(accountId);
    if (!account) {
      throw new AppError('ACCOUNT_NOT_FOUND', 'Account was not found.');
    }

    const adapter = this.deps.adapterRegistry.get(account.platform as PlatformType);
    const startedAt = this.now();
    const operationId = randomUUID();
    let result: CheckInResult;

    if (!adapter.checkIn) {
      result = {
        accountId,
        result: 'unsupported',
        message: 'Check-in is not supported for this platform.',
      };
    } else {
      result = await this.runAdapterCheckIn(adapter, accountId, account);
    }

    const finishedAt = this.now();
    const normalizedResult: CheckInResult = {
      accountId,
      result: result.result,
      message: messageForResult(result.result),
    };
    const succeeded = normalizedResult.result === 'success' || normalizedResult.result === 'already_checked_in';
    this.deps.operationRepository.record({
      id: operationId,
      accountId,
      kind: 'checkin',
      status: succeeded ? 'success' : 'error',
      startedAt,
      finishedAt,
      errorCode: succeeded ? undefined : normalizedResult.result.toUpperCase(),
      errorSummary: succeeded ? undefined : normalizedResult.message,
    });
    this.deps.checkInResultRepository.record({
      operationId,
      accountId,
      result: normalizedResult.result,
      message: normalizedResult.message,
      checkedAt: finishedAt,
    });

    return normalizedResult;
  }

  private async runAdapterCheckIn(
    adapter: PlatformAdapter,
    accountId: string,
    account: {
      baseUrl: string;
      platform: string;
    },
  ): Promise<CheckInResult> {
    try {
      return await adapter.checkIn!({
        accountId,
        baseUrl: account.baseUrl,
        platform: account.platform as AccountRequestContext['platform'],
        partition: getAccountPartition(accountId),
        // 站内用户 ID 为 New-Api-User 头必需；缺失时适配器判会话失效。
        siteUserId: this.deps.authStateRepository.getSiteUserId(accountId) ?? undefined,
      });
    } catch {
      return {
        accountId,
        result: 'failed',
        message: 'Check-in request failed.',
      };
    }
  }
}
