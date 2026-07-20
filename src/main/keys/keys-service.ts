import { AppError } from '../../shared/ipc/errors';
import type { ApiKeyRecord } from '../../shared/ipc/bridge';
import type { AccountRepository } from '../storage/repositories/account-repository';
import type { AccountAuthStateRepository } from '../storage/repositories/account-auth-state-repository';
import type { NewApiKeysClient, NewApiKeysRequest } from '../adapters/newapi/newapi-keys-client';
import { requireSiteUserId } from '../adapters/newapi/newapi-auth-context';

type AccountRepositoryPort = Pick<AccountRepository, 'get'>;
type AuthStateRepositoryPort = Pick<AccountAuthStateRepository, 'getSiteUserId'>;
type KeysClientPort = Pick<NewApiKeysClient, 'listByAccount' | 'reveal'>;

export interface KeysServiceDependencies {
  accountRepository: AccountRepositoryPort;
  authStateRepository: AuthStateRepositoryPort;
  keysClient: KeysClientPort;
}

/**
 * 密钥管理服务。
 *
 * 将 accountId 解析为 baseUrl + 站内用户 ID 后委托 NewApiKeysClient 拉取/揭示密钥。
 * 红线：
 * - 仅 newapi 平台支持；其余平台明确报 NOT_IMPLEMENTED，绝不伪造空列表；
 * - 缺少站内用户 ID 报 AUTH_METADATA_REQUIRED（网络调用前拦截）；
 * - listByAccount 返回脱敏视图，reveal 明文仅当次返回、绝不落盘；
 * - 账户不存在报 ACCOUNT_NOT_FOUND。
 */
export class KeysService {
  private readonly accountRepository: AccountRepositoryPort;
  private readonly authStateRepository: AuthStateRepositoryPort;
  private readonly keysClient: KeysClientPort;

  constructor(dependencies: KeysServiceDependencies) {
    this.accountRepository = dependencies.accountRepository;
    this.authStateRepository = dependencies.authStateRepository;
    this.keysClient = dependencies.keysClient;
  }

  async listByAccount(accountId: string): Promise<ApiKeyRecord[]> {
    const request = this.resolveRequest(accountId);
    return this.keysClient.listByAccount(request);
  }

  async reveal(accountId: string, tokenId: number): Promise<string> {
    const request = this.resolveRequest(accountId);
    return this.keysClient.reveal(request, tokenId);
  }

  /** 解析账户为查询请求；账户不存在、平台不支持或缺站内用户 ID 时抛错。 */
  private resolveRequest(accountId: string): NewApiKeysRequest {
    const account = this.accountRepository.get(accountId);
    if (!account) {
      throw new AppError('ACCOUNT_NOT_FOUND', 'Account was not found.');
    }
    if (account.platform !== 'newapi') {
      throw new AppError('NOT_IMPLEMENTED', 'Key management is only available for NewAPI sites.');
    }
    const siteUserId = requireSiteUserId(this.authStateRepository, accountId);
    return { accountId, baseUrl: account.baseUrl, siteUserId };
  }
}
