import { AppError } from '../../shared/ipc/errors';
import type { ApiKeyRecord, CaptureKeysResult } from '../../shared/ipc/bridge';
import type { AccountRepository, AccountEntity } from '../storage/repositories/account-repository';
import type { AccountAuthStateRepository } from '../storage/repositories/account-auth-state-repository';
import type {
  AccountKeysRepository,
  AccountKeyEntity,
  AccountKeyMetadata,
} from '../storage/repositories/account-keys-repository';
import type { NewApiKeysClient, NewApiKeysRequest } from '../adapters/newapi/newapi-keys-client';
import { requireSiteUserId } from '../adapters/newapi/newapi-auth-context';
import type { VaultService } from '../security/vault-service';

type AccountRepositoryPort = Pick<AccountRepository, 'get'>;
type AuthStateRepositoryPort = Pick<AccountAuthStateRepository, 'getSiteUserId'>;
type KeysClientPort = Pick<NewApiKeysClient, 'listByAccount' | 'reveal'>;
type KeysRepositoryPort = Pick<
  AccountKeysRepository,
  'listByAccount' | 'get' | 'replaceAccountMetadata' | 'attachPlaintext'
>;
type VaultPort = Pick<VaultService, 'storeSecret' | 'readSecret' | 'deleteSecret'>;

export interface KeysServiceDependencies {
  accountRepository: AccountRepositoryPort;
  authStateRepository: AuthStateRepositoryPort;
  keysClient: KeysClientPort;
  keysRepository: KeysRepositoryPort;
  vault: VaultPort;
}

/** Vault secrets 表中密钥明文的用途标签（与账密凭据等其它用途区分）。 */
const KEY_SECRET_PURPOSE = 'newapi_token_key';

/**
 * 明文密文的确定性引用 id：`account-key:{siteId}:{tokenId}`。
 * 稳定可复算，便于 upsert 幂等；token id 在站内稳定，故同站点内唯一。
 */
function makeSecretId(siteId: string, tokenId: number): string {
  return `account-key:${siteId}:${tokenId}`;
}

/** 本地密钥行 → 脱敏视图（hasPlaintext 表示明文是否已惰性入库）。 */
function toRecord(entity: AccountKeyEntity): ApiKeyRecord {
  return {
    id: entity.tokenId,
    accountId: entity.accountId,
    name: entity.name,
    maskedKey: entity.maskedKey,
    group: entity.group,
    remainQuota: entity.remainQuota,
    unlimitedQuota: entity.unlimitedQuota,
    usedQuota: entity.usedQuota,
    status: entity.status,
    createdTime: entity.createdTime,
    expiredTime: entity.expiredTime,
    hasPlaintext: Boolean(entity.plaintextSecretId),
  };
}

/** 远程脱敏记录 → 本地表元数据（丢弃 accountId/hasPlaintext，改由本地表管理）。 */
function toMetadata(record: ApiKeyRecord): AccountKeyMetadata {
  return {
    tokenId: record.id,
    name: record.name,
    maskedKey: record.maskedKey,
    group: record.group,
    remainQuota: record.remainQuota,
    unlimitedQuota: record.unlimitedQuota,
    usedQuota: record.usedQuota,
    status: record.status,
    createdTime: record.createdTime,
    expiredTime: record.expiredTime,
  };
}

/**
 * 密钥管理服务（本地密钥表 + 惰性明文）。
 *
 * 数据流：
 * - listByAccount：**本地表优先**，只读持久化元数据，绝不联网；
 * - refresh：联网拉远程全量列表，覆盖本地元数据（保留已入库明文引用），
 *   清理远程已删除密钥对应的孤儿明文；仅刷新元数据，不获取明文；
 * - reveal：本地已入库明文则**离线解密**返回；未入库则联网获取、加密入库后返回；
 * - captureAll：批量获取账户内尚未入库的明文并加密入库，仅返回计数。
 *
 * 安全红线：
 * - 仅 newapi 平台支持；其余平台报 NOT_IMPLEMENTED；账户不存在报 ACCOUNT_NOT_FOUND；
 * - 联网路径缺站内用户 ID 报 AUTH_METADATA_REQUIRED（网络调用前拦截）；
 * - 完整明文只走 Vault 信封加密持久化 + reveal 当次返回，绝不写日志/快照/明文缓存；
 * - 本地表元数据 key 恒脱敏。
 */
export class KeysService {
  private readonly accountRepository: AccountRepositoryPort;
  private readonly authStateRepository: AuthStateRepositoryPort;
  private readonly keysClient: KeysClientPort;
  private readonly keysRepository: KeysRepositoryPort;
  private readonly vault: VaultPort;

  constructor(dependencies: KeysServiceDependencies) {
    this.accountRepository = dependencies.accountRepository;
    this.authStateRepository = dependencies.authStateRepository;
    this.keysClient = dependencies.keysClient;
    this.keysRepository = dependencies.keysRepository;
    this.vault = dependencies.vault;
  }

  /** 读取账户的本地密钥列表（脱敏视图），不联网。 */
  async listByAccount(accountId: string): Promise<ApiKeyRecord[]> {
    this.resolveAccount(accountId);
    return this.keysRepository.listByAccount(accountId).map(toRecord);
  }

  /**
   * 刷新账户密钥：联网拉远程全量列表覆盖本地元数据，清理孤儿明文；
   * 仅刷新元数据（明文按需惰性获取）。返回刷新后的本地脱敏列表。
   */
  async refresh(accountId: string): Promise<ApiKeyRecord[]> {
    const { account, siteId } = this.resolveAccount(accountId);
    const request = this.buildRequest(account, accountId);
    const remote = await this.keysClient.listByAccount(request);

    const { orphanSecretIds } = this.keysRepository.replaceAccountMetadata({
      accountId,
      siteId,
      records: remote.map(toMetadata),
      updatedAt: new Date().toISOString(),
    });
    // 远程已删除密钥对应的明文密文清理，避免孤儿累积。
    for (const secretId of orphanSecretIds) {
      this.vault.deleteSecret(secretId);
    }

    return this.keysRepository.listByAccount(accountId).map(toRecord);
  }

  /**
   * 揭示单个密钥完整明文。
   * 本地已入库则离线解密返回（不联网、不要求站内用户 ID）；
   * 未入库则联网获取、加密入库（有本地元数据行时）后返回。
   */
  async reveal(accountId: string, tokenId: number): Promise<string> {
    const { account, siteId } = this.resolveAccount(accountId);
    const local = this.keysRepository.get(tokenId, siteId);

    // 本地已入库：离线解密，无需联网。
    if (local?.plaintextSecretId) {
      const cached = this.vault.readSecret(local.plaintextSecretId);
      if (cached !== null) {
        return cached;
      }
    }

    // 未入库或密文缺失：联网获取明文。
    const request = this.buildRequest(account, accountId);
    const plaintext = await this.keysClient.reveal(request, tokenId);

    // 仅在本地有元数据行时挂靠入库，避免产生无归属的孤儿密文。
    if (local) {
      this.persistPlaintext(accountId, siteId, tokenId, plaintext);
    }
    return plaintext;
  }

  /**
   * 批量获取账户内尚未入库的密钥明文并加密入库。
   * 逐个隔离：单个失败只计 failed，不中断其余；仅返回计数，绝不回传明文。
   */
  async captureAll(accountId: string): Promise<CaptureKeysResult> {
    const { account, siteId } = this.resolveAccount(accountId);
    const pending = this.keysRepository
      .listByAccount(accountId)
      .filter(entity => !entity.plaintextSecretId);

    if (pending.length === 0) {
      return { accountId, total: 0, captured: 0, failed: 0 };
    }

    const request = this.buildRequest(account, accountId);
    let captured = 0;
    let failed = 0;
    for (const entity of pending) {
      try {
        const plaintext = await this.keysClient.reveal(request, entity.tokenId);
        this.persistPlaintext(accountId, siteId, entity.tokenId, plaintext);
        captured += 1;
      } catch {
        // 单个密钥获取失败（会话过期、上游异常等）只计数，不外泄错误细节。
        failed += 1;
      }
    }

    return { accountId, total: pending.length, captured, failed };
  }

  /** 加密明文入 Vault 并在本地表登记引用。 */
  private persistPlaintext(
    accountId: string,
    siteId: string,
    tokenId: number,
    plaintext: string,
  ): void {
    const secretId = makeSecretId(siteId, tokenId);
    this.vault.storeSecret(secretId, accountId, KEY_SECRET_PURPOSE, plaintext);
    this.keysRepository.attachPlaintext(tokenId, siteId, secretId, new Date().toISOString());
  }

  /** 校验账户存在且为 newapi 平台；返回账户实体与站点 id（纯本地，不要求站内用户 ID）。 */
  private resolveAccount(accountId: string): { account: AccountEntity; siteId: string } {
    const account = this.accountRepository.get(accountId);
    if (!account) {
      throw new AppError('ACCOUNT_NOT_FOUND', 'Account was not found.');
    }
    if (account.platform !== 'newapi') {
      throw new AppError('NOT_IMPLEMENTED', 'Key management is only available for NewAPI sites.');
    }
    if (!account.siteId) {
      throw new AppError('ACCOUNT_NOT_FOUND', 'Account is not associated with a site.');
    }
    return { account, siteId: account.siteId };
  }

  /** 构造联网请求（额外要求站内用户 ID；缺失抛 AUTH_METADATA_REQUIRED）。 */
  private buildRequest(account: AccountEntity, accountId: string): NewApiKeysRequest {
    const siteUserId = requireSiteUserId(this.authStateRepository, accountId);
    return { accountId, baseUrl: account.baseUrl, siteUserId };
  }
}
