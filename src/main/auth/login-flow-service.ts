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
type HeadlessLoginPort = Pick<LinuxDoHeadlessLogin, 'run'>;

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
  linuxDoHeadlessLogin?: HeadlessLoginPort;
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

    const adapterAccount = toAdapterAccount(account);
    const adapter = this.deps.adapterRegistry.get(adapterAccount.platform);
    const preferAuto = mode === 'auto' || mode === 'linuxdo';

    appLogger.info(`[登录] 开始 account=${accountId} mode=${mode} preferAuto=${preferAuto}`);

    await this.maybeSyncIdpCookies(accountId, account.authRefId ?? null);

    /** 无头失败时的中文原因，拼进最终 UI 提示。 */
    let headlessFallbackDetail: string | null = null;

    if (preferAuto) {
      const headlessAttempt = await this.tryLinuxDoHeadless(adapterAccount);
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
        appLogger.info(`[登录] 跳过自动登录（无 LinuxDo 前置或未注入服务） account=${accountId}`);
      }
    }

    // 自动失败或 manual：打开站点登录页（manual 域白名单更宽）。
    const useManualBrowser = mode === 'manual' || !resolveLinuxDoOAuthPlan(adapterAccount);
    const request = useManualBrowser
      ? this.getManualRequest(adapterAccount, adapter)
      : this.getLinuxDoRequest(adapterAccount);

    appLogger.info(
      `[登录] 打开受控窗口 account=${accountId} startUrl=${request.startUrl} path=${useManualBrowser ? 'manual-domains' : 'linuxdo-domains'}`,
    );

    // 仅强制 manual 或 auto 降级到站点页时启用站内用户 ID 捕获（窗口路径）。
    const identityCapture = this.prepareIdentityCapture(
      accountId,
      account.baseUrl,
      'manual',
      adapterAccount.platform,
    );

    await this.deps.browserContainer.open({
      ...request,
      accountId,
      baseUrl: account.baseUrl,
      onWebContentsReady: identityCapture?.onWebContentsReady,
      onClosed: () => {
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
  private async tryLinuxDoHeadless(
    account: AdapterAccount,
  ): Promise<
    | { kind: 'skip' }
    | { kind: 'done'; result: LoginResult }
    | { kind: 'fallback'; reason: string; detail: string }
  > {
    const headless = this.deps.linuxDoHeadlessLogin;
    if (!headless) {
      appLogger.info('[登录] 无头服务未注入，跳过自动登录');
      return { kind: 'skip' };
    }

    if (!resolveLinuxDoOAuthPlan(account)) {
      appLogger.info(`[登录] 账户无 LinuxDo Client ID / plan，跳过自动登录 account=${account.id}`);
      return { kind: 'skip' };
    }

    let outcome: LinuxDoHeadlessOutcome;
    try {
      appLogger.info(`[登录] 开始无头协议 account=${account.id}`);
      outcome = await headless.run(account);
    } catch (error) {
      const detail = error instanceof Error ? error.message : '未知异常';
      appLogger.warn(`[登录] 无头流程抛错 account=${account.id} error=${detail}`);
      return { kind: 'fallback', reason: 'THROWN', detail: '无头流程异常' };
    }

    if (outcome.ok) {
      const label =
        outcome.authState === 'active' && outcome.hasSiteUserId ? '无头成功' : '无头完成（会话未完全就绪）';
      appLogger.info(
        `[登录] ${label} account=${account.id} authState=${outcome.authState} hasSiteUserId=${outcome.hasSiteUserId}`,
      );
      return {
        kind: 'done',
        result: {
          accountId: account.id,
          mode: 'auto',
          authState: outcome.authState,
          message: outcome.message,
        },
      };
    }

    appLogger.warn(
      `[登录] 无头失败 account=${account.id} reason=${outcome.reason} fallback=${outcome.fallbackToBrowser} msg=${outcome.message}`,
    );

    if (outcome.fallbackToBrowser) {
      return {
        kind: 'fallback',
        reason: outcome.reason,
        detail: outcome.message,
      };
    }

    appLogger.warn(
      `[登录] 无头硬失败（不开窗）account=${account.id} reason=${outcome.reason}`,
    );
    return {
      kind: 'done',
      result: {
        accountId: account.id,
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
    } catch {
      appLogger.warn(`[登录] IdP Cookie 同步失败（不阻断） account=${accountId}`);
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
