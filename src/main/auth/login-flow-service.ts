import { AppError } from '../../shared/ipc/errors';
import type { LoginMode, LoginResult } from '../../shared/ipc/bridge';
import type { AdapterAccount } from '../../shared/domain/platform-adapter';
import type { AdapterRegistry } from '../adapters/adapter-registry';
import type { ControlledBrowserContainer, ControlledWebContentsLike } from '../browser/browser-container';
import type { AccountRepository } from '../storage/repositories/account-repository';
import type { AuthIdentityRepository } from '../storage/repositories/auth-identity-repository';
import type { AuthSessionService } from './auth-session-service';
import type { IdpCookieSyncService } from './idp-cookie-sync';
import { resolveLinuxDoOAuthPlan } from '../adapters/newapi/linuxdo-oauth';
import {
  createSiteIdentityCapture,
  type SiteIdentityCaptureHandle,
  type SiteIdentityStore,
} from '../adapters/newapi/newapi-browser-identity-capture';
import { DEFAULT_MANUAL_OAUTH_DOMAINS, type IdpAuthKind } from './idp-hosts';

type AccountRepositoryPort = Pick<AccountRepository, 'get'>;
type AdapterRegistryPort = Pick<AdapterRegistry, 'get'>;
type BrowserContainerPort = Pick<ControlledBrowserContainer, 'open'>;
type AuthSessionServicePort = Pick<AuthSessionService, 'refreshAuthState'>;
type AuthIdentityRepositoryPort = Pick<AuthIdentityRepository, 'get'>;
type IdpCookieSyncPort = Pick<IdpCookieSyncService, 'syncLinkedIdpCookies'>;

export interface LoginFlowServiceDependencies {
  accountRepository: AccountRepositoryPort;
  adapterRegistry: AdapterRegistryPort;
  browserContainer: BrowserContainerPort;
  authSessionService: AuthSessionServicePort;
  /** auth 身份仓储：读取账户绑定 auth 的类型，决定是否同步 IdP Cookie。 */
  authIdentityRepository?: AuthIdentityRepositoryPort;
  /** IdP Cookie 同步服务：打开登录窗前把绑定 auth 的 IdP Cookie 注入账户 partition。 */
  idpCookieSync?: IdpCookieSyncPort;
  /** 站内用户 ID 持久化：NewAPI manual 登录时受控捕获后写入（缺省则不捕获）。 */
  siteIdentityStore?: SiteIdentityStore;
  /** 捕获器工厂（默认 createSiteIdentityCapture，便于测试注入）。 */
  createIdentityCapture?: typeof createSiteIdentityCapture;
}

function isIdpAuthKind(kind: string): kind is IdpAuthKind {
  return kind === 'github' || kind === 'linuxdo';
}

function toAdapterAccount(account: {
  id: string;
  platform: string;
  baseUrl: string;
  displayName: string;
  linuxDoClientId?: string;
  routeProfile?: AdapterAccount['routeProfile'];
}): AdapterAccount {
  return {
    id: account.id,
    platform: account.platform as AdapterAccount['platform'],
    baseUrl: account.baseUrl,
    displayName: account.displayName,
    linuxDoClientId: account.linuxDoClientId,
    routeProfile: account.routeProfile,
  };
}

/**
 * 打开账户专属的手动或 LinuxDo 官方认证页面。
 * 应用只导航到适配器确认的目标页，不读取表单、不收集密码、不交换 OAuth code；
 * 容器关闭后仅重新校验目标站点会话，active 才代表登录成功。
 */
export class LoginFlowService {
  constructor(private readonly deps: LoginFlowServiceDependencies) {}

  async open(accountId: string, mode: LoginMode): Promise<LoginResult> {
    const account = this.deps.accountRepository.get(accountId);
    if (!account) {
      throw new AppError('ACCOUNT_NOT_FOUND', 'Account was not found.');
    }

    const adapterAccount = toAdapterAccount(account);
    const adapter = this.deps.adapterRegistry.get(adapterAccount.platform);
    const request = mode === 'linuxdo'
      ? this.getLinuxDoRequest(adapterAccount)
      : this.getManualRequest(adapterAccount, adapter);

    // 打开站点登录窗前，先把绑定 auth 身份的 IdP Cookie 注入账户 partition，
    // 让站点 OAuth 复用已登录会话（失败不阻断，降级为用户手动完成）。
    await this.maybeSyncIdpCookies(accountId, account.authRefId ?? null);

    // 仅 NewAPI manual 登录时启用站内用户 ID 受控提取（linuxdo OAuth 窗口不启用）。
    const identityCapture = this.prepareIdentityCapture(
      accountId,
      account.baseUrl,
      mode,
      adapterAccount.platform,
    );

    await this.deps.browserContainer.open({
      ...request,
      accountId,
      baseUrl: account.baseUrl,
      onWebContentsReady: identityCapture?.onWebContentsReady,
      onClosed: () => {
        // 关窗即停止提取，随后重新校验会话（此时站内用户 ID 通常已捕获持久化）。
        identityCapture?.stop();
        void this.deps.authSessionService.refreshAuthState(accountId);
      },
    });

    return {
      accountId,
      mode,
      authState: 'unknown',
      message: 'Login window opened. Complete authentication on the official site.',
    };
  }

  /**
   * 为 NewAPI manual 登录准备站内用户 ID 受控提取。
   *
   * 仅当 mode=manual、平台为 newapi、已注入持久化存储且 baseUrl 可解析出 origin 时启用；
   * 返回窗口就绪回调与停止函数，其余情形返回 null（不提取）。
   */
  private prepareIdentityCapture(
    accountId: string,
    baseUrl: string,
    mode: LoginMode,
    platform: AdapterAccount['platform'],
  ): { onWebContentsReady: (webContents: ControlledWebContentsLike) => void; stop: () => void } | null {
    const store = this.deps.siteIdentityStore;
    if (mode !== 'manual' || platform !== 'newapi' || !store) {
      return null;
    }

    let expectedOrigin: string;
    try {
      expectedOrigin = new URL(baseUrl).origin;
    } catch {
      return null;
    }

    const createCapture = this.deps.createIdentityCapture ?? createSiteIdentityCapture;
    let handle: SiteIdentityCaptureHandle | null = null;
    return {
      onWebContentsReady: webContents => {
        handle = createCapture({ accountId, expectedOrigin, webContents, repository: store });
        handle.start();
      },
      stop: () => handle?.stop(),
    };
  }

  /**
   * 若账户绑定了 github/linuxdo 类型 auth 身份，则在打开登录窗前同步其 IdP Cookie。
   * password 类型与未绑定跳过；同步失败仅记日志、不抛出，保证登录窗仍可打开。
   */
  private async maybeSyncIdpCookies(accountId: string, authRefId: string | null): Promise<void> {
    if (!authRefId || !this.deps.idpCookieSync || !this.deps.authIdentityRepository) {
      return;
    }

    const identity = this.deps.authIdentityRepository.get(authRefId);
    if (!identity || !isIdpAuthKind(identity.kind)) {
      return;
    }

    try {
      await this.deps.idpCookieSync.syncLinkedIdpCookies({
        accountId,
        authId: authRefId,
        kind: identity.kind,
      });
    } catch {
      // 同步失败降级：不阻断登录窗打开；不记录 Cookie 值等敏感内容。
    }
  }

  private getManualRequest(
    account: AdapterAccount,
    adapter: ReturnType<AdapterRegistryPort['get']>,
  ): { startUrl: string; oauthDomains: string[]; redirectDomains: string[] } {
    const url = adapter.getPageUrl(account, 'login');
    if (!url) {
      throw new AppError('NOT_IMPLEMENTED', 'Manual login is not available for this platform.');
    }

    // manual 登录默认放行 GitHub + LinuxDo OAuth 域名，并把站点自身 host 纳入回跳域，
    // 让站点原生 OAuth 能跳转到 IdP 并回跳站点完成登录。
    let siteHost: string | undefined;
    try {
      siteHost = new URL(account.baseUrl).hostname;
    } catch {
      siteHost = undefined;
    }

    return {
      startUrl: url.toString(),
      oauthDomains: [...DEFAULT_MANUAL_OAUTH_DOMAINS],
      redirectDomains: siteHost ? [siteHost] : [],
    };
  }

  private getLinuxDoRequest(account: AdapterAccount): {
    startUrl: string;
    oauthDomains: string[];
    redirectDomains: string[];
  } {
    const plan = resolveLinuxDoOAuthPlan(account);
    if (!plan) {
      throw new AppError('NOT_IMPLEMENTED', 'LinuxDo login is unavailable. Use manual in-app login instead.');
    }

    return {
      startUrl: plan.startUrl.toString(),
      oauthDomains: plan.oauthDomains,
      redirectDomains: plan.redirectDomains,
    };
  }
}
