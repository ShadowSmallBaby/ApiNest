import { randomUUID } from 'node:crypto';
import { AppError } from '../../shared/ipc/errors';
import type { CheckInResult, KnownPage, PlatformType } from '../../shared/ipc/bridge';
import type {
  AccountRequestContext,
  AdapterAccount,
  PlatformAdapter,
} from '../../shared/domain/platform-adapter';
import type { AdapterRegistry } from '../adapters/adapter-registry';
import { getAccountPartition } from '../auth/account-partition';
import type { AccountRepository } from '../storage/repositories/account-repository';
import type { AccountAuthStateRepository } from '../storage/repositories/account-auth-state-repository';
import type { CheckInResultRepository } from '../storage/repositories/checkin-result-repository';
import type { OperationRepository } from '../storage/repositories/operation-repository';
import type { SiteRepository } from '../storage/repositories/site-repository';
import type { AuthIdentityRepository } from '../storage/repositories/auth-identity-repository';
import type { IdpCookieSyncService } from '../auth/idp-cookie-sync';
import type { ControlledBrowserContainer } from '../browser/browser-container';
import { DEFAULT_MANUAL_OAUTH_DOMAINS, type IdpAuthKind } from '../auth/idp-hosts';
import { appLogger } from '../logging/logger';

type AccountRepositoryPort = Pick<AccountRepository, 'get'>;
type AuthStateRepositoryPort = Pick<AccountAuthStateRepository, 'getSiteUserId'>;
type AdapterRegistryPort = Pick<AdapterRegistry, 'get'>;
type OperationRepositoryPort = Pick<OperationRepository, 'record'>;
type CheckInResultRepositoryPort = Pick<CheckInResultRepository, 'record'>;
type SiteRepositoryPort = Pick<SiteRepository, 'get'>;
type AuthIdentityRepositoryPort = Pick<AuthIdentityRepository, 'get'>;
type IdpCookieSyncPort = Pick<IdpCookieSyncService, 'syncLinkedIdpCookies'>;
type BrowserContainerPort = Pick<ControlledBrowserContainer, 'open'>;

export interface CheckInServiceDependencies {
  accountRepository: AccountRepositoryPort;
  authStateRepository: AuthStateRepositoryPort;
  adapterRegistry: AdapterRegistryPort;
  operationRepository: OperationRepositoryPort;
  checkInResultRepository: CheckInResultRepositoryPort;
  /** 读取站点 checkInSiteUrl / 路由配置。 */
  siteRepository?: SiteRepositoryPort;
  authIdentityRepository?: AuthIdentityRepositoryPort;
  idpCookieSync?: IdpCookieSyncPort;
  browserContainer?: BrowserContainerPort;
  now?: () => string;
}

function messageForResult(result: CheckInResult['result'], detail?: string): string {
  switch (result) {
    case 'success':
      return 'Check-in completed.';
    case 'already_checked_in':
      return 'Already checked in for the current period.';
    case 'session_expired':
      return 'The account session has expired.';
    case 'challenge_required':
      return detail ?? 'Human verification is required. Open the site page to complete the challenge, then retry.';
    case 'unsupported':
      return 'Check-in is not supported for this platform.';
    case 'cancelled':
      return 'Check-in was cancelled.';
    case 'failed':
      return 'Check-in request failed.';
  }
}

function isIdpAuthKind(kind: string): kind is IdpAuthKind {
  return kind === 'github' || kind === 'linuxdo';
}

/** 用户明确触发的一次单账户签到；不重试、不调度、不伪造成功结果。 */
export class CheckInService {
  private readonly now: () => string;

  constructor(private readonly deps: CheckInServiceDependencies) {
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  async run(accountId: string): Promise<CheckInResult> {
    const account = this.deps.accountRepository.get(accountId);
    if (!account) {
      throw new AppError('ACCOUNT_NOT_FOUND', 'Account was not found.');
    }

    const adapter = this.deps.adapterRegistry.get(account.platform as PlatformType);
    const startedAt = this.now();
    const operationId = randomUUID();
    let result: CheckInResult;

    const site =
      account.siteId && this.deps.siteRepository
        ? this.deps.siteRepository.get(account.siteId)
        : null;
    const externalCheckInUrl = site?.checkInSiteUrl?.trim();

    if (externalCheckInUrl) {
      result = await this.openExternalCheckInSite(accountId, account, externalCheckInUrl);
    } else if (!adapter.checkIn) {
      result = {
        accountId,
        result: 'unsupported',
        message: 'Check-in is not supported for this platform.',
      };
    } else {
      result = await this.runAdapterCheckIn(adapter, accountId, account);
      if (
        result.result === 'failed' ||
        result.result === 'session_expired' ||
        result.result === 'challenge_required'
      ) {
        await this.openFallbackPage(
          accountId,
          account,
          adapter,
          result.result === 'session_expired' ? 'login' : 'userCenter',
        );
      }
    }

    const finishedAt = this.now();
    const normalizedResult: CheckInResult = {
      accountId,
      result: result.result,
      message:
        result.result === 'challenge_required' && result.message
          ? result.message
          : messageForResult(result.result, result.message),
    };
    // 打开外部签到站 / 需要人工操作：记 operation 但不计为今日已签到成功。
    const succeeded =
      normalizedResult.result === 'success' || normalizedResult.result === 'already_checked_in';
    this.deps.operationRepository.record({
      id: operationId,
      accountId,
      kind: 'checkin',
      status: succeeded ? 'success' : 'error',
      startedAt,
      finishedAt,
      errorCode: succeeded ? undefined : normalizedResult.result.toUpperCase(),
      errorSummary: succeeded ? undefined : normalizedResult.message,
    });
    this.deps.checkInResultRepository.record({
      operationId,
      accountId,
      result: normalizedResult.result,
      message: normalizedResult.message,
      checkedAt: finishedAt,
    });

    return normalizedResult;
  }

  private async openExternalCheckInSite(
    accountId: string,
    account: {
      siteId?: string;
      baseUrl: string;
      platform: string;
      displayName: string;
      linuxDoClientId?: string;
      routeProfile?: AdapterAccount['routeProfile'];
      authRefId?: string | null;
    },
    checkInSiteUrl: string,
  ): Promise<CheckInResult> {
    if (!this.deps.browserContainer) {
      return {
        accountId,
        result: 'failed',
        message: 'Browser container is not available for external check-in.',
      };
    }

    await this.maybeSyncIdpCookies(accountId, account.authRefId ?? null);

    let startUrl: string;
    let siteHost: string | undefined;
    try {
      startUrl = new URL(checkInSiteUrl).toString();
      siteHost = new URL(checkInSiteUrl).hostname;
    } catch {
      return {
        accountId,
        result: 'failed',
        message: 'Invalid external check-in site URL.',
      };
    }

    try {
      await this.deps.browserContainer.open({
        accountId,
        baseUrl: account.baseUrl,
        startUrl,
        oauthDomains: [...DEFAULT_MANUAL_OAUTH_DOMAINS],
        redirectDomains: siteHost ? [siteHost] : [],
      });
      appLogger.info(`[签到] 已打开外部签到站 account=${accountId} url=${startUrl}`);
      return {
        accountId,
        result: 'challenge_required',
        message: '已打开签到站，请在页面中手动完成签到。',
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown';
      appLogger.warn(`[签到] 打开外部签到站失败 account=${accountId} error=${detail}`);
      return {
        accountId,
        result: 'failed',
        message: 'Failed to open external check-in site.',
      };
    }
  }

  private async openFallbackPage(
    accountId: string,
    account: {
      baseUrl: string;
      platform: string;
      displayName: string;
      linuxDoClientId?: string;
      routeProfile?: AdapterAccount['routeProfile'];
    },
    adapter: PlatformAdapter,
    page: KnownPage,
  ): Promise<void> {
    if (!this.deps.browserContainer) {
      return;
    }
    const adapterAccount: AdapterAccount = {
      id: accountId,
      platform: account.platform as AdapterAccount['platform'],
      baseUrl: account.baseUrl,
      displayName: account.displayName,
      linuxDoClientId: account.linuxDoClientId,
      routeProfile: account.routeProfile,
    };
    const url = adapter.getPageUrl(adapterAccount, page);
    if (!url) {
      return;
    }
    let siteHost: string | undefined;
    try {
      siteHost = new URL(account.baseUrl).hostname;
    } catch {
      siteHost = undefined;
    }
    try {
      await this.deps.browserContainer.open({
        accountId,
        baseUrl: account.baseUrl,
        startUrl: url.toString(),
        oauthDomains: [...DEFAULT_MANUAL_OAUTH_DOMAINS],
        redirectDomains: siteHost ? [siteHost] : [],
      });
      appLogger.info(`[签到] 签到失败已打开站点页面 account=${accountId} page=${page}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown';
      appLogger.warn(`[签到] 打开回退页面失败 account=${accountId} error=${detail}`);
    }
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
        `[签到] IdP Cookie 已同步 account=${accountId} kind=${identity.kind} copied=${result.copied}`,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : '未知异常';
      appLogger.warn(
        `[签到] IdP Cookie 同步失败（不阻断） account=${accountId} kind=${identity.kind} error=${detail}`,
      );
    }
  }

  private async runAdapterCheckIn(
    adapter: PlatformAdapter,
    accountId: string,
    account: {
      baseUrl: string;
      platform: string;
    },
  ): Promise<CheckInResult> {
    try {
      return await adapter.checkIn!({
        accountId,
        baseUrl: account.baseUrl,
        platform: account.platform as AccountRequestContext['platform'],
        partition: getAccountPartition(accountId),
        // 站内用户 ID 为 New-Api-User 头必需；缺失时适配器判会话失效。
        siteUserId: this.deps.authStateRepository.getSiteUserId(accountId) ?? undefined,
      });
    } catch {
      return {
        accountId,
        result: 'failed',
        message: 'Check-in request failed.',
      };
    }
  }
}
