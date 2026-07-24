import type { AuthKind, AuthLoginTarget, LoginResult } from '../../shared/ipc/bridge';
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

/**
 * 各 IdP 的官方登录起始页（固定，不猜测、不拼接任意回跳）。
 *
 * LinuxDo：OAuth 实际在 connect.linux.do；论坛 linux.do 登录后还需 Discourse SSO
 * 桥接到 connect。入口打开 connect，并放行两个 host，便于用户完成桥接登录。
 */
const IDP_LOGIN_URL: Partial<
  Record<AuthKind, { startUrl: string; redirectDomains: string[] }>
> = {
  github: { startUrl: 'https://github.com/login', redirectDomains: ['github.com'] },
  linuxdo: {
    startUrl: 'https://connect.linux.do/',
    redirectDomains: ['connect.linux.do', 'linux.do'],
  },
};

/**
 * LinuxDo 类型的可选登录目标站点（主人授权：同一登录窗体复用现有逻辑，仅换加载站点）。
 *
 * 主站 linux.do 与 Credit 站 credit.linux.do 与 connect 之间可能发生 Discourse SSO
 * 互跳，故统一放行三者，避免登录途中被导航策略拦截。
 */
const LINUXDO_TARGET_URL: Record<
  Exclude<AuthLoginTarget, 'default'>,
  { startUrl: string; redirectDomains: string[] }
> = {
  linuxdoMain: {
    startUrl: 'https://linux.do/',
    redirectDomains: ['connect.linux.do', 'linux.do', 'credit.linux.do'],
  },
  linuxdoCredit: {
    startUrl: 'https://credit.linux.do/',
    redirectDomains: ['connect.linux.do', 'linux.do', 'credit.linux.do'],
  },
};

type AuthIdentityRepositoryPort = Pick<AuthIdentityRepository, 'get'>;
type BrowserContainerPort = Pick<ControlledBrowserContainer, 'open'>;

export interface AuthIdentityLoginFlowDependencies {
  repository: AuthIdentityRepositoryPort;
  browserContainer: BrowserContainerPort;
}

export class AuthIdentityLoginFlow {
  constructor(private readonly deps: AuthIdentityLoginFlowDependencies) {}

  /**
   * 在 auth 专属 partition 打开对应 IdP 登录页；password 类型不支持。
   *
   * target 指定登录窗体加载的站点：
   *  - default：各 IdP 默认起始页（github→github.com、linuxdo→connect.linux.do）；
   *  - linuxdoMain / linuxdoCredit：仅 linuxdo 类型可用，改打开主站 / Credit 站，
   *    复用同一登录窗体逻辑，仅替换加载 URL 与放行域名。
   */
  async open(authId: string, target: AuthLoginTarget = 'default'): Promise<LoginResult> {
    const entity = this.deps.repository.get(authId);
    if (!entity) {
      throw new AppError('ACCOUNT_NOT_FOUND', 'Auth identity was not found.');
    }

    const idp = IDP_LOGIN_URL[entity.kind as AuthKind];
    if (!idp) {
      throw new AppError('INVALID_ARGUMENT', 'This auth identity type has no interactive login.');
    }

    // linuxdo 专属目标（主站/Credit）仅对 linuxdo 类型开放；其余类型传入即拒绝。
    let resolved = idp;
    if (target !== 'default') {
      if (entity.kind !== 'linuxdo') {
        throw new AppError('INVALID_ARGUMENT', 'This auth identity type does not support the requested login target.');
      }
      resolved = LINUXDO_TARGET_URL[target];
    }

    const partition = getAuthPartition(authId);
    await this.deps.browserContainer.open({
      // accountId 字段沿用为容器标识；此处传 authId 仅用于窗口生命周期，
      // 实际会话隔离由显式 partition 决定（auth 专属，不与任何账户共享）。
      accountId: authId,
      partition,
      baseUrl: resolved.startUrl,
      startUrl: resolved.startUrl,
      // linuxdo 同时放行论坛与 connect（及 Credit），以便完成 Discourse SSO 桥接。
      oauthDomains: resolved.redirectDomains,
      redirectDomains: resolved.redirectDomains,
    });

    return {
      accountId: authId,
      mode: 'manual',
      authState: 'unknown',
      message: '已打开登录窗口，请在官方页面完成认证。',
    };
  }
}
