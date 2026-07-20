import type { AuthKind, LoginResult } from '../../shared/ipc/bridge';
import { AppError } from '../../shared/ipc/errors';
import type { AuthIdentityRepository } from '../storage/repositories/auth-identity-repository';
import type { ControlledBrowserContainer } from '../browser/browser-container';
import { getAuthPartition } from './account-partition';

/**
 * auth 身份的「登录一次」流程（R13 演进，决策 3）。
 *
 * github / linuxdo 类型的 auth 身份拥有各自的专属持久 partition
 * （persist:apinest-auth-<authId>）。点击登录时，在该 auth 专属 partition 内打开
 * 对应 IdP 的官方登录页，由用户亲自完成登录；登录态持久化在该 auth partition 内。
 *
 * 安全红线：
 *  - 只在 auth 专属 partition 内打开 IdP 官方页，绝不注入本应用 Preload；
 *  - 不采集/代填 IdP 账号密码，不绕过验证码/二次验证/授权确认；
 *  - 不复制、不搬运任何 IdP Cookie（与账户 partition 严格隔离）；
 *  - password 类型没有 IdP 登录概念，调用即拒绝。
 */

/** 各 IdP 的官方登录起始页（固定，不猜测、不拼接任意回跳）。 */
const IDP_LOGIN_URL: Partial<Record<AuthKind, { startUrl: string; host: string }>> = {
  github: { startUrl: 'https://github.com/login', host: 'github.com' },
  linuxdo: { startUrl: 'https://linux.do/', host: 'linux.do' },
};

type AuthIdentityRepositoryPort = Pick<AuthIdentityRepository, 'get'>;
type BrowserContainerPort = Pick<ControlledBrowserContainer, 'open'>;

export interface AuthIdentityLoginFlowDependencies {
  repository: AuthIdentityRepositoryPort;
  browserContainer: BrowserContainerPort;
}

export class AuthIdentityLoginFlow {
  constructor(private readonly deps: AuthIdentityLoginFlowDependencies) {}

  /** 在 auth 专属 partition 打开对应 IdP 登录页；password 类型不支持。 */
  async open(authId: string): Promise<LoginResult> {
    const entity = this.deps.repository.get(authId);
    if (!entity) {
      throw new AppError('ACCOUNT_NOT_FOUND', 'Auth identity was not found.');
    }

    const idp = IDP_LOGIN_URL[entity.kind as AuthKind];
    if (!idp) {
      throw new AppError('INVALID_ARGUMENT', 'This auth identity type has no interactive login.');
    }

    const partition = getAuthPartition(authId);
    await this.deps.browserContainer.open({
      // accountId 字段沿用为容器标识；此处传 authId 仅用于窗口生命周期，
      // 实际会话隔离由显式 partition 决定（auth 专属，不与任何账户共享）。
      accountId: authId,
      partition,
      baseUrl: idp.startUrl,
      startUrl: idp.startUrl,
      redirectDomains: [idp.host],
    });

    return {
      accountId: authId,
      mode: 'manual',
      authState: 'unknown',
      message: 'Login window opened. Complete authentication on the official site.',
    };
  }
}
