import { AppError } from '../../shared/ipc/errors';
import type { ModelRecord } from '../../shared/ipc/bridge';
import type { AccountRepository } from '../storage/repositories/account-repository';
import type { AccountAuthStateRepository } from '../storage/repositories/account-auth-state-repository';
import type { NewApiModelsClient, NewApiModelsRequest } from '../adapters/newapi/newapi-models-client';
import { requireSiteUserId } from '../adapters/newapi/newapi-auth-context';

type AccountRepositoryPort = Pick<AccountRepository, 'get'>;
type AuthStateRepositoryPort = Pick<AccountAuthStateRepository, 'getSiteUserId'>;
type ModelsClientPort = Pick<NewApiModelsClient, 'listByAccount'>;

export interface ModelsServiceDependencies {
  accountRepository: AccountRepositoryPort;
  authStateRepository: AuthStateRepositoryPort;
  modelsClient: ModelsClientPort;
}

/**
 * 模型管理服务。
 *
 * 将 accountId 解析为 baseUrl + 站内用户 ID 后委托 NewApiModelsClient 拉取模型定价与账户可用标注。
 * 红线：
 * - 仅 newapi 平台支持；其余平台明确报 NOT_IMPLEMENTED，绝不伪造空列表；
 * - 缺少站内用户 ID 报 AUTH_METADATA_REQUIRED；
 * - 账户不存在报 ACCOUNT_NOT_FOUND。
 */
export class ModelsService {
  private readonly accountRepository: AccountRepositoryPort;
  private readonly authStateRepository: AuthStateRepositoryPort;
  private readonly modelsClient: ModelsClientPort;

  constructor(dependencies: ModelsServiceDependencies) {
    this.accountRepository = dependencies.accountRepository;
    this.authStateRepository = dependencies.authStateRepository;
    this.modelsClient = dependencies.modelsClient;
  }

  async listByAccount(accountId: string): Promise<ModelRecord[]> {
    const request = this.resolveRequest(accountId);
    return this.modelsClient.listByAccount(request);
  }

  /** 解析账户为查询请求；账户不存在、平台不支持或缺站内用户 ID 时抛错。 */
  private resolveRequest(accountId: string): NewApiModelsRequest {
    const account = this.accountRepository.get(accountId);
    if (!account) {
      throw new AppError('ACCOUNT_NOT_FOUND', 'Account was not found.');
    }
    if (account.platform !== 'newapi') {
      throw new AppError('NOT_IMPLEMENTED', 'Model management is only available for NewAPI sites.');
    }
    const siteUserId = requireSiteUserId(this.authStateRepository, accountId);
    return { accountId, baseUrl: account.baseUrl, siteUserId };
  }
}
