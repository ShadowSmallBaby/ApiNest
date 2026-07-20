import { AppError } from '../../shared/ipc/errors';
import type { UsageLogPage, UsageLogQuery } from '../../shared/ipc/bridge';
import type { AccountRepository } from '../storage/repositories/account-repository';
import type { AccountAuthStateRepository } from '../storage/repositories/account-auth-state-repository';
import type { NewApiLogsClient, NewApiLogsRequest } from '../adapters/newapi/newapi-logs-client';
import { requireSiteUserId } from '../adapters/newapi/newapi-auth-context';

type AccountRepositoryPort = Pick<AccountRepository, 'get'>;
type AuthStateRepositoryPort = Pick<AccountAuthStateRepository, 'getSiteUserId'>;
type LogsClientPort = Pick<NewApiLogsClient, 'listByAccount'>;

export interface LogsServiceDependencies {
  accountRepository: AccountRepositoryPort;
  authStateRepository: AuthStateRepositoryPort;
  logsClient: LogsClientPort;
}

/**
 * 日志查询服务。
 *
 * 将 accountId 解析为 baseUrl + 站内用户 ID 后委托 NewApiLogsClient 在线拉取安全投影日志。
 * 红线：仅 newapi 平台支持；账户不存在/平台不支持/缺站内用户 ID 时明确报错；不持久化远端原始日志。
 */
export class LogsService {
  private readonly accountRepository: AccountRepositoryPort;
  private readonly authStateRepository: AuthStateRepositoryPort;
  private readonly logsClient: LogsClientPort;

  constructor(dependencies: LogsServiceDependencies) {
    this.accountRepository = dependencies.accountRepository;
    this.authStateRepository = dependencies.authStateRepository;
    this.logsClient = dependencies.logsClient;
  }

  async listByAccount(accountId: string, query: UsageLogQuery): Promise<UsageLogPage> {
    const request = this.resolveRequest(accountId, query);
    return this.logsClient.listByAccount(request);
  }

  private resolveRequest(accountId: string, query: UsageLogQuery): NewApiLogsRequest {
    const account = this.accountRepository.get(accountId);
    if (!account) {
      throw new AppError('ACCOUNT_NOT_FOUND', 'Account was not found.');
    }
    if (account.platform !== 'newapi') {
      throw new AppError('NOT_IMPLEMENTED', 'Usage logs are only available for NewAPI sites.');
    }
    const siteUserId = requireSiteUserId(this.authStateRepository, accountId);
    return { accountId, baseUrl: account.baseUrl, siteUserId, query };
  }
}
