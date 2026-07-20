import type { VaultService } from '../security/vault-service';

/**
 * auth 身份的账号密码加密凭据引用（R13 演进，类 K8s Secret 引用）。
 *
 * 凭据绑定 auth 身份（authId）而非单个账户，因此一份 password 类型的 auth 身份
 * 可被多个账户引用。UI 与业务层只持有“引用句柄”，明文只在用户当次主动登录时、
 * 于主进程内解密并用于目标站点原生登录表单填充。存取规则：
 *  - 复用既有 Vault 信封加密（Argon2id → DEK → AEAD 逐条加密）；
 *  - 明文仅在主进程内存中短暂存在，用后立即丢弃引用；
 *  - 严禁写入普通字段、日志、快照、操作 details 或 UI；
 *  - 仅用于目标站点原生登录表单，不得用于绕过验证码/Cloudflare/Passkey 等安全挑战；
 *  - 不提供任何读取明文的对外通道（本服务的读取只服务于主进程内表单填充）。
 */

/** secrets 表中 auth 身份账密引用的固定用途标识。 */
export const AUTH_IDENTITY_CREDENTIAL_PURPOSE = 'auth_identity_credential';

/** 站点账号密码明文（仅在主进程内存中短暂存在）。 */
export interface SiteCredentialPlaintext {
  username: string;
  password: string;
}

type VaultPort = Pick<VaultService, 'storeSecret' | 'readSecret' | 'hasSecret' | 'deleteSecret'>;

export interface SiteCredentialServiceDependencies {
  vault: VaultPort;
}

/** 由 authId 派生确定性 secretId，使存取幂等且严格按 auth 身份隔离。 */
function deriveSecretId(authId: string): string {
  return `${AUTH_IDENTITY_CREDENTIAL_PURPOSE}:${authId}`;
}

export class SiteCredentialService {
  constructor(private readonly deps: SiteCredentialServiceDependencies) {}

  /** 保存/覆盖 auth 身份的账密引用。明文一次性加密落盘后即丢弃，不回传、不留存于内存之外。 */
  save(authId: string, plaintext: SiteCredentialPlaintext): void {
    const serialized = JSON.stringify({
      username: plaintext.username,
      password: plaintext.password,
    });
    this.deps.vault.storeSecret(
      deriveSecretId(authId),
      authId,
      AUTH_IDENTITY_CREDENTIAL_PURPOSE,
      serialized,
    );
  }

  /** 是否已保存该 auth 身份的账密引用（仅布尔存在性，绝不返回内容）。 */
  has(authId: string): boolean {
    return this.deps.vault.hasSecret(deriveSecretId(authId));
  }

  /** 清除该 auth 身份的账密引用。 */
  clear(authId: string): void {
    this.deps.vault.deleteSecret(deriveSecretId(authId));
  }

  /**
   * 读取明文，仅供主进程内目标站点原生登录表单填充使用。
   * 调用方必须在使用后立即丢弃返回值，绝不可回传 Renderer、写入日志或持久化。
   */
  reveal(authId: string): SiteCredentialPlaintext | null {
    const raw = this.deps.vault.readSecret(deriveSecretId(authId));
    if (raw === null) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<SiteCredentialPlaintext>;
      if (typeof parsed.username !== 'string' || typeof parsed.password !== 'string') {
        return null;
      }
      return { username: parsed.username, password: parsed.password };
    } catch {
      return null;
    }
  }
}
