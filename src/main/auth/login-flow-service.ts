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
  LinuxDoHeadlessLogin,
  type LinuxDoHeadlessOutcome,
} from '../adapters/newapi/linuxdo-headless-login';
import { resolveGitHubOAuthPlan } from '../adapters/newapi/github-oauth';
import {
  GitHubHeadlessLogin,
  type GitHubHeadlessOutcome,
} from '../adapters/newapi/github-headless-login';
import { APINEST_OAUTH_DEBUG } from '../adapters/newapi/oauth-debug';
import { attachManualLoginNavLogger } from '../adapters/newapi/manual-login-nav-logger';
import {
  createSiteIdentityCapture,
  type SiteIdentityCaptureHandle,
  type SiteIdentityStore,
} from '../adapters/newapi/newapi-browser-identity-capture';
import { DEFAULT_MANUAL_OAUTH_DOMAINS, type IdpAuthKind } from './idp-hosts';
import { appLogger } from '../logging/logger';

type AccountRepositoryPort = Pick<AccountRepository, 'get'>;
type AdapterRegistryPort = Pick<AdapterRegistry, 'get'>;
type BrowserContainerPort = Pick<ControlledBrowserContainer, 'open'>;
type AuthSessionServicePort = Pick<AuthSessionService, 'refreshAuthState'>;
type AuthIdentityRepositoryPort = Pick<AuthIdentityRepository, 'get'>;
type IdpCookieSyncPort = Pick<IdpCookieSyncService, 'syncLinkedIdpCookies'>;
type LinuxDoHeadlessLoginPort = Pick<LinuxDoHeadlessLogin, 'run'>;
type GitHubHeadlessLoginPort = Pick<GitHubHeadlessLogin, 'run'>;
/** 站点级 OAuth Client ID 解析端口（优先 site_oauth_configs，可回退历史字段）。 */
type SiteOAuthClientIdResolver = {
  getClientId(siteId: string, provider: 'github' | 'linuxdo'): string | null;
};

export interface LoginFlowServiceDependencies {
  accountRepository: AccountRepositoryPort;
  adapterRegistry: AdapterRegistryPort;
  browserContainer: BrowserContainerPort;
  authSessionService: AuthSessionServicePort;
  authIdentityRepository?: AuthIdentityRepositoryPort;
  idpCookieSync?: IdpCookieSyncPort;
  siteIdentityStore?: SiteIdentityStore;
  createIdentityCapture?: typeof createSiteIdentityCapture;
  /**
   * LinuxDo 无头自动登录（session.fetch）。
   * 2026-07-22 主人授权：可代点同意；失败且可降级时再打开受控窗口。
   */
  linuxDoHeadlessLogin?: LinuxDoHeadlessLoginPort;
  /** GitHub 无头自动登录：state → authorize → /oauth/github 回调写 Cookie。 */
  githubHeadlessLogin?: GitHubHeadlessLoginPort;
  /** 站点级多 OAuth 配置表；优先于账户/站点历史 linuxDoClientId。 */
  siteOAuthClientIds?: SiteOAuthClientIdResolver;
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
  githubClientId?: string;
  routeProfile?: AdapterAccount['routeProfile'];
}): AdapterAccount {
  return {
    id: account.id,
    platform: account.platform as AdapterAccount['platform'],
    baseUrl: account.baseUrl,
    displayName: account.displayName,
    linuxDoClientId: account.linuxDoClientId,
    githubClientId: account.githubClientId,
    routeProfile: account.routeProfile,
  };
}

/**
 * 账户登录编排。
 *
 * - auto / linuxdo：有 LinuxDo 前置条件时先无头自动，失败可降级受控窗口；无前置则直接窗口。
 * - manual：强制受控窗口 + 可选 siteUserId 捕获。
 */
export class LoginFlowService {
  constructor(private readonly deps: LoginFlowServiceDependencies) {}

  async open(accountId: string, mode: LoginMode = 'auto'): Promise<LoginResult> {
    const account = this.deps.accountRepository.get(accountId);
    if (!account) {
      throw new AppError('ACCOUNT_NOT_FOUND', 'Account was not found.');
    }

    const adapterAccount = this.resolveAdapterAccount(account);
    const adapter = this.deps.adapterRegistry.get(adapterAccount.platform);
    const preferAuto = mode === 'auto' || mode === 'linuxdo';

    appLogger.info(`[登录] 开始 account=${accountId} mode=${mode} preferAuto=${preferAuto}`);

    await this.maybeSyncIdpCookies(accountId, account.authRefId ?? null);

    /** 无头失败时的中文原因，拼进最终 UI 提示。 */
    let headlessFallbackDetail: string | null = null;

    if (preferAuto) {
      const preferredProvider = this.resolvePreferredOAuthProvider(
        account.authRefId ?? null,
        adapterAccount,
      );
      const headlessAttempt = await this.tryAutoHeadless(
        adapterAccount,
        preferredProvider,
      );
      if (headlessAttempt.kind === 'done') {
        const fullyOk =
          headlessAttempt.result.authState === 'active';
        appLogger.info(
          `[登录] 自动登录${fullyOk ? '成功' : '结束'} account=${accountId} authState=${headlessAttempt.result.authState}`,
        );
        return headlessAttempt.result;
      }
      if (headlessAttempt.kind === 'fallback') {
        headlessFallbackDetail = headlessAttempt.detail;
        appLogger.warn(
          `[登录] 自动登录失败，回退手动窗口 account=${accountId} reason=${headlessAttempt.reason} detail=${headlessAttempt.detail}`,
        );
      } else {
        appLogger.info(`[登录] 跳过自动登录（无 OAuth 前置或未注入服务） account=${accountId}`);
      }
    }

    // 自动失败或 manual：打开站点登录页（manual 域白名单更宽）。
    const oauthPlan =
      resolveGitHubOAuthPlan(adapterAccount) ?? resolveLinuxDoOAuthPlan(adapterAccount);
    const useManualBrowser = mode === 'manual' || !oauthPlan;
    const request = useManualBrowser
      ? this.getManualRequest(adapterAccount, adapter)
      : this.getOAuthBrowserRequest(adapterAccount);

    const oauthPath = useManualBrowser
      ? 'manual-domains'
      : resolveGitHubOAuthPlan(adapterAccount)
        ? 'github-domains'
        : 'linuxdo-domains';
    appLogger.info(
      `[登录] 打开受控窗口 account=${accountId} startUrl=${request.startUrl} path=${oauthPath}`,
    );

    // 仅强制 manual 或 auto 降级到站点页时启用站内用户 ID 捕获（窗口路径）。
    const identityCapture = this.prepareIdentityCapture(
      accountId,
      account.baseUrl,
      'manual',
      adapterAccount.platform,
    );

    // 调试期才挂手动窗导航日志（含 GitHub 授权确认页识别）；正式路径不启用。
    let navLogger: { stop(): void } | null = null;

    await this.deps.browserContainer.open({
      ...request,
      accountId,
      baseUrl: account.baseUrl,
      onWebContentsReady: webContents => {
        identityCapture?.onWebContentsReady(webContents);
        if (APINEST_OAUTH_DEBUG) {
          navLogger = attachManualLoginNavLogger({
            accountId,
            siteBaseUrl: account.baseUrl,
            webContents,
          });
        }
      },
      onClosed: () => {
        navLogger?.stop();
        identityCapture?.stop();
        void this.deps.authSessionService.refreshAuthState(accountId);
      },
    });

    const message = preferAuto
      ? headlessFallbackDetail
        ? `自动登录未完成（${headlessFallbackDetail}）。已打开登录窗口，请在官方页面完成认证。`
        : '自动登录未完成，已打开登录窗口，请在官方页面完成认证。'
      : '已打开登录窗口，请在官方页面完成认证。';

    appLogger.info(`[登录] 已打开手动窗口 account=${accountId} message=${message}`);

    return {
      accountId,
      mode: preferAuto ? 'auto' : mode,
      authState: 'unknown',
      message,
    };
  }

  /**
   * 尝试 LinuxDo 无头登录。
   * - skip：无 plan / 未注入服务
   * - done：成功或不可降级错误（直接返回 LoginResult）
   * - fallback：可降级失败，调用方开窗
   */
  /**
   * 组装适配器账户视图：优先从站点级 OAuth 配置表取 Client ID，
   * LinuxDo 缺失时回退历史字段，保证旧数据仍可登录。
   */
  private resolveAdapterAccount(account: {
    id: string;
    siteId?: string | null;
    platform: string;
    baseUrl: string;
    displayName: string;
    linuxDoClientId?: string;
    routeProfile?: AdapterAccount['routeProfile'];
  }): AdapterAccount {
    const linuxDoFromTable =
      account.siteId && this.deps.siteOAuthClientIds
        ? this.deps.siteOAuthClientIds.getClientId(account.siteId, 'linuxdo')
        : null;
    const githubFromTable =
      account.siteId && this.deps.siteOAuthClientIds
        ? this.deps.siteOAuthClientIds.getClientId(account.siteId, 'github')
        : null;
    return toAdapterAccount({
      ...account,
      linuxDoClientId: linuxDoFromTable ?? account.linuxDoClientId,
      githubClientId: githubFromTable ?? undefined,
    });
  }

  /** 根据绑定身份选择优先 OAuth 提供商。 */
  private resolvePreferredOAuthProvider(
    authRefId: string | null,
    account: AdapterAccount,
  ): 'github' | 'linuxdo' {
    if (authRefId && this.deps.authIdentityRepository) {
      const identity = this.deps.authIdentityRepository.get(authRefId);
      if (identity?.kind === 'github' && resolveGitHubOAuthPlan(account)) {
        return 'github';
      }
      if (identity?.kind === 'linuxdo' && resolveLinuxDoOAuthPlan(account)) {
        return 'linuxdo';
      }
    }
    // 无绑定身份：优先已配置的 GitHub，否则 LinuxDo
    if (resolveGitHubOAuthPlan(account)) {
      return 'github';
    }
    return 'linuxdo';
  }

  private async tryAutoHeadless(
    account: AdapterAccount,
    preferred: 'github' | 'linuxdo',
  ): Promise<
    | { kind: 'skip' }
    | { kind: 'done'; result: LoginResult }
    | { kind: 'fallback'; reason: string; detail: string }
  > {
    // 按绑定身份优先尝试；若该提供商未配置 plan 则 skip 并尝试另一家。
    // 一旦某提供商返回 fallback（已尝试但需开窗），不再静默切换。
    // IdP Cookie 已在 open() 开头 maybeSyncIdpCookies 复制到账户 partition。
    const order: Array<'github' | 'linuxdo'> =
      preferred === 'github' ? ['github', 'linuxdo'] : ['linuxdo', 'github'];

    for (const provider of order) {
      const attempt =
        provider === 'github'
          ? await this.tryGitHubHeadless(account)
          : await this.tryLinuxDoHeadless(account);
      if (attempt.kind !== 'skip') {
        return attempt;
      }
    }
    return { kind: 'skip' };
  }

  private async tryGitHubHeadless(
    account: AdapterAccount,
  ): Promise<
    | { kind: 'skip' }
    | { kind: 'done'; result: LoginResult }
    | { kind: 'fallback'; reason: string; detail: string }
  > {
    const headless = this.deps.githubHeadlessLogin;
    if (!headless) {
      return { kind: 'skip' };
    }
    if (!resolveGitHubOAuthPlan(account)) {
      appLogger.info(`[登录] 账户无 GitHub Client ID / plan，跳过 account=${account.id}`);
      return { kind: 'skip' };
    }
    // 与 LinuxDo 一致：IdP Cookie 已由 maybeSyncIdpCookies 复制到账户 partition，
    // 无头流程全程在账户 partition 执行，不传 authId。
    return this.mapHeadlessOutcome(
      account.id,
      'GitHub',
      await this.safeRunHeadless(() => headless.run(account)),
    );
  }

  private async tryLinuxDoHeadless(
    account: AdapterAccount,
  ): Promise<
    | { kind: 'skip' }
    | { kind: 'done'; result: LoginResult }
    | { kind: 'fallback'; reason: string; detail: string }
  > {
    const headless = this.deps.linuxDoHeadlessLogin;
    if (!headless) {
      return { kind: 'skip' };
    }

    if (!resolveLinuxDoOAuthPlan(account)) {
      appLogger.info(`[登录] 账户无 LinuxDo Client ID / plan，跳过 account=${account.id}`);
      return { kind: 'skip' };
    }

    return this.mapHeadlessOutcome(account.id, 'LinuxDo', await this.safeRunHeadless(() => headless.run(account)));
  }

  private async safeRunHeadless(
    run: () => Promise<LinuxDoHeadlessOutcome | GitHubHeadlessOutcome>,
  ): Promise<LinuxDoHeadlessOutcome | GitHubHeadlessOutcome | { thrown: true; detail: string }> {
    try {
      return await run();
    } catch (error) {
      const detail = error instanceof Error ? error.message : '未知异常';
      return { thrown: true, detail };
    }
  }

  private mapHeadlessOutcome(
    accountId: string,
    label: 'GitHub' | 'LinuxDo',
    outcome:
      | LinuxDoHeadlessOutcome
      | GitHubHeadlessOutcome
      | { thrown: true; detail: string },
  ):
    | { kind: 'done'; result: LoginResult }
    | { kind: 'fallback'; reason: string; detail: string } {
    if ('thrown' in outcome) {
      appLogger.warn(`[登录] ${label} 无头流程抛错 account=${accountId} error=${outcome.detail}`);
      return { kind: 'fallback', reason: 'THROWN', detail: `${label} 无头流程异常` };
    }

    if (outcome.ok) {
      appLogger.info(
        `[登录] ${label} 无头完成 account=${accountId} authState=${outcome.authState} hasSiteUserId=${outcome.hasSiteUserId}`,
      );
      return {
        kind: 'done',
        result: {
          accountId,
          mode: 'auto',
          authState: outcome.authState,
          message: outcome.message,
        },
      };
    }

    appLogger.warn(
      `[登录] ${label} 无头失败 account=${accountId} reason=${outcome.reason} fallback=${outcome.fallbackToBrowser} msg=${outcome.message}`,
    );

    if (outcome.fallbackToBrowser) {
      return {
        kind: 'fallback',
        reason: outcome.reason,
        detail: outcome.message,
      };
    }

    return {
      kind: 'done',
      result: {
        accountId,
        mode: 'auto',
        authState: 'error',
        message: outcome.message,
      },
    };
  }

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

  private async maybeSyncIdpCookies(accountId: string, authRefId: string | null): Promise<void> {
    if (!authRefId || !this.deps.idpCookieSync || !this.deps.authIdentityRepository) {
      return;
    }

    const identity = this.deps.authIdentityRepository.get(authRefId);
    if (!identity || !isIdpAuthKind(identity.kind)) {
      return;
    }

    try {
      const result = await this.deps.idpCookieSync.syncLinkedIdpCookies({
        accountId,
        authId: authRefId,
        kind: identity.kind,
      });
      appLogger.info(
        `[登录] IdP Cookie 已同步 account=${accountId} kind=${identity.kind} copied=${result.copied}`,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : '未知异常';
      appLogger.warn(
        `[登录] IdP Cookie 同步失败（不阻断） account=${accountId} kind=${identity.kind} error=${detail}`,
      );
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

  private getOAuthBrowserRequest(account: AdapterAccount): {
    startUrl: string;
    oauthDomains: string[];
    redirectDomains: string[];
  } {
    const github = resolveGitHubOAuthPlan(account);
    if (github) {
      return {
        startUrl: github.startUrl.toString(),
        oauthDomains: github.oauthDomains,
        redirectDomains: github.redirectDomains,
      };
    }
    const linuxdo = resolveLinuxDoOAuthPlan(account);
    if (!linuxdo) {
      throw new AppError('NOT_IMPLEMENTED', 'OAuth login is unavailable. Use manual in-app login instead.');
    }
    return {
      startUrl: linuxdo.startUrl.toString(),
      oauthDomains: linuxdo.oauthDomains,
      redirectDomains: linuxdo.redirectDomains,
    };
  }
}
