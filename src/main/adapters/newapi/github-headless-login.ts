/**
 * GitHub 无头 OAuth 编排（主进程 session.fetch，账户 partition）。
 *
 * 与 LinuxDo 保持一致：
 * - 登录前由 LoginFlowService 将 auth 身份的 IdP Cookie 复制到账户 partition
 * - state / authorize / 站点回调 全程在账户 partition 完成
 *
 * 流程：state → authorize → 站点回调写 Cookie。
 * code 仅瞬态，不落库/不日志。失败可降级受控窗口。
 */

import type { AdapterAccount } from '../../../shared/domain/platform-adapter';
import type { AuthState } from '../../../shared/ipc/bridge';
import { getAccountPartition } from '../../auth/account-partition';
import type { SessionRequestClient, SessionResponse } from '../session-request-client';
import { resolveGitHubOAuthPlan } from './github-oauth';
import {
  buildGitHubOAuthUrls,
  isGitHubPasswordLoginUrl,
  isRedirectStatus,
  normalizeNewApiGitHubCallbackUrl,
  parseGitHubOAuthStateResponse,
  parseTrustedGitHubCallbackLocationDetailed,
  readLocationHeader,
  type GitHubProtocolFailureReason,
} from './github-oauth-protocol';
import {
  describeCallbackBody,
  extractSiteUserIdFromCallbackBody,
} from './linuxdo-oauth-protocol';
import { classifyNewApiSession } from './session';
import { normalizeSiteUserId } from './newapi-site-identity';
import type { SiteIdentityStore } from './newapi-browser-identity-capture';
import { appLogger } from '../../logging/logger';
import { oauthDebug } from './oauth-debug';

export type GitHubHeadlessOutcome =
  | {
      ok: true;
      authState: AuthState;
      hasSiteUserId: boolean;
      message: string;
    }
  | {
      ok: false;
      reason: GitHubProtocolFailureReason;
      fallbackToBrowser: boolean;
      message: string;
    };

export interface GitHubHeadlessLoginDependencies {
  sessionClient: SessionRequestClient;
  siteIdentityStore?: SiteIdentityStore;
  refreshAuthState: (accountId: string) => Promise<AuthState>;
  now?: () => string;
}

const OAUTH_TIMEOUT_MS = 20_000;
/** GitHub authorize 跨境链路可能较慢，单独放宽。 */
const GITHUB_AUTHORIZE_TIMEOUT_MS = 45_000;
const SELF_ENDPOINT = '/api/user/self';

export class GitHubHeadlessLogin {
  private readonly now: () => string;

  constructor(private readonly deps: GitHubHeadlessLoginDependencies) {
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  async run(account: AdapterAccount): Promise<GitHubHeadlessOutcome> {
    const plan = resolveGitHubOAuthPlan(account);
    if (!plan) {
      appLogger.info(`[GitHub] 无 plan，跳过 account=${account.id}`);
      return {
        ok: false,
        reason: 'STATE_FAILED',
        fallbackToBrowser: false,
        message: '当前账户未配置可用的 GitHub 登录。',
      };
    }

    // 与 LinuxDo 一致：全程账户 partition（IdP Cookie 已由 LoginFlow 同步进来）
    const partition = getAccountPartition(account.id);
    appLogger.info(`[GitHub] 开始无头登录 account=${account.id} site=${plan.siteOrigin}`);
    oauthDebug('github run start', {
      accountId: account.id,
      baseUrl: account.baseUrl,
      clientId: plan.clientId,
      siteOrigin: plan.siteOrigin,
      stateUrl: plan.stateUrl.toString(),
      partition,
    });

    // 1) state
    let state: string;
    try {
      appLogger.info(`[GitHub] ① 请求 OAuth state`);
      const stateResponse = await this.deps.sessionClient.fetchWithSession(plan.stateUrl.toString(), {
        partition,
        method: 'GET',
        timeoutMs: OAUTH_TIMEOUT_MS,
      });
      oauthDebug('github ① state raw', {
        status: stateResponse.status,
        headers: stateResponse.headers,
        body: stateResponse.bodyText,
      });
      const parsed = parseGitHubOAuthStateResponse(stateResponse.bodyText);
      if (stateResponse.status < 200 || stateResponse.status >= 300 || !parsed) {
        appLogger.warn(
          `[GitHub] ① state 失败 status=${stateResponse.status} bodyLen=${stateResponse.bodyText.length}`,
        );
        return fail('STATE_FAILED', true, '未能从站点获取 OAuth state，将尝试手动登录。');
      }
      state = parsed;
      appLogger.info(`[GitHub] ① state 成功 len=${state.length}`);
    } catch (error) {
      const detail = formatError(error);
      appLogger.warn(`[GitHub] ① state 网络异常: ${detail}`);
      return fail('NETWORK_ERROR', true, `请求 OAuth state 失败：${shortError(detail)}`);
    }

    const urls = buildGitHubOAuthUrls(account.baseUrl, plan.clientId, state);
    if (!urls) {
      appLogger.warn(`[GitHub] 无法组装 authorize URL`);
      return fail('STATE_FAILED', true, '无法组装 GitHub 授权地址，将尝试手动登录。');
    }

    // 2) authorize（账户 partition，Cookie 已从 auth 同步）
    appLogger.info(`[GitHub] ② 打开 authorize host=github.com`);
    const authorizeStep = await this.resolveAuthorize(
      account,
      partition,
      urls.authorizeUrl,
      state,
    );
    if (authorizeStep.kind === 'fail') {
      return authorizeStep.outcome;
    }

    // 3) 站点回调（写 Cookie）
    return this.finishCallback(account, partition, authorizeStep.callbackUrl);
  }

  /**
   * 跟随 GitHub authorize。
   * 策略：先 manual 抓第一跳 Location（快）；失败再 follow。
   * 避免 follow 在 GitHub 多跳链路里拖到超时。
   */
  private async resolveAuthorize(
    account: AdapterAccount,
    partition: string,
    authorizeUrl: string,
    state: string,
  ): Promise<
    | { kind: 'callback'; callbackUrl: string }
    | { kind: 'fail'; outcome: GitHubHeadlessOutcome }
  > {
    // 1) manual 优先
    const manual = await this.tryFetch(
      authorizeUrl,
      partition,
      'manual',
      GITHUB_AUTHORIZE_TIMEOUT_MS,
    );
    if (manual.ok) {
      const location = readLocationHeader(manual.response.headers) ?? manual.response.finalUrl;
      appLogger.info(
        `[GitHub] ② authorize(manual) status=${manual.response.status} toHost=${safeHost(location) ?? 'n/a'}`,
      );
      oauthDebug('github ② authorize manual', {
        status: manual.response.status,
        location,
        finalUrl: manual.response.finalUrl,
        headers: manual.response.headers,
      });
      if (location && isGitHubPasswordLoginUrl(location)) {
        return {
          kind: 'fail',
          outcome: fail(
            'NEEDS_INTERACTIVE',
            true,
            'GitHub 尚未登录，请先在「认证身份」中登录 GitHub。',
          ),
        };
      }
      const fromManual = this.interpretAuthorizeResponse(
        manual.response,
        account.baseUrl,
        state,
        'manual',
      );
      if (fromManual) {
        return fromManual;
      }
      // manual 拿到 github 中间页：再 follow 该 Location
      if (location && safeHost(location)?.includes('github.com')) {
        appLogger.info(`[GitHub] ② manual 落到 GitHub 中间页，继续 follow 该 URL`);
        const hop = await this.tryFetch(location, partition, 'follow', GITHUB_AUTHORIZE_TIMEOUT_MS);
        if (hop.ok) {
          const fromHop = this.interpretAuthorizeResponse(
            hop.response,
            account.baseUrl,
            state,
            'follow',
          );
          if (fromHop) {
            return fromHop;
          }
        } else {
          appLogger.warn(`[GitHub] ② 中间页 follow 失败: ${hop.error}`);
        }
      }
    } else {
      appLogger.warn(`[GitHub] ② authorize(manual) 失败: ${manual.error}`);
    }

    // 2) follow 整条 authorize
    const followed = await this.tryFetch(
      authorizeUrl,
      partition,
      'follow',
      GITHUB_AUTHORIZE_TIMEOUT_MS,
    );
    if (followed.ok) {
      appLogger.info(
        `[GitHub] ② authorize(follow) status=${followed.response.status} finalHost=${safeHost(followed.response.finalUrl) ?? 'n/a'}`,
      );
      oauthDebug('github ② authorize follow', {
        status: followed.response.status,
        finalUrl: followed.response.finalUrl,
        location: followed.response.headers.location,
        bodyLen: followed.response.bodyText.length,
      });
      const fromFollow = this.interpretAuthorizeResponse(
        followed.response,
        account.baseUrl,
        state,
        'follow',
      );
      if (fromFollow) {
        return fromFollow;
      }
    } else {
      appLogger.warn(`[GitHub] ② authorize(follow) 异常: ${followed.error}`);
    }

    return {
      kind: 'fail',
      outcome: fail(
        'NEEDS_INTERACTIVE',
        true,
        '无法完成 GitHub 授权（网络超时或需先在认证身份中登录 GitHub），将打开手动登录。',
      ),
    };
  }

  private interpretAuthorizeResponse(
    response: SessionResponse,
    siteBaseUrl: string,
    state: string,
    mode: 'manual' | 'follow',
  ):
    | { kind: 'callback'; callbackUrl: string }
    | { kind: 'fail'; outcome: GitHubHeadlessOutcome }
    | null {
    if (isRedirectStatus(response.status)) {
      const location = readLocationHeader(response.headers);
      if (location && isGitHubPasswordLoginUrl(location)) {
        return {
          kind: 'fail',
          outcome: fail(
            'NEEDS_INTERACTIVE',
            true,
            'GitHub 尚未登录，请先在「认证身份」中登录 GitHub。',
          ),
        };
      }
      if (location) {
        const trusted = this.trustCallback(location, siteBaseUrl, state);
        if (trusted) {
          appLogger.info(`[GitHub] ② authorize(${mode}) 直接回跳站点回调`);
          return { kind: 'callback', callbackUrl: trusted };
        }
      }
      return null;
    }

    if (response.finalUrl) {
      if (isGitHubPasswordLoginUrl(response.finalUrl)) {
        return {
          kind: 'fail',
          outcome: fail(
            'NEEDS_INTERACTIVE',
            true,
            'GitHub 尚未登录，请先在「认证身份」中登录 GitHub。',
          ),
        };
      }
      const trusted = this.trustCallback(response.finalUrl, siteBaseUrl, state);
      if (trusted) {
        appLogger.info(`[GitHub] ② authorize(${mode}) finalUrl 已是站点回调`);
        return { kind: 'callback', callbackUrl: trusted };
      }
    }

    // follow 后 status=200 时尝试从 HTML 抠回调
    if (response.status >= 200 && response.status < 300) {
      const metaRedirect =
        /url=["']([^"']*oauth\/github[^"']*)["']/i.exec(response.bodyText)?.[1] ??
        /href=["']([^"']*oauth\/github[^"']*)["']/i.exec(response.bodyText)?.[1];
      if (metaRedirect) {
        const trusted = this.trustCallback(metaRedirect, siteBaseUrl, state);
        if (trusted) {
          appLogger.info(`[GitHub] ② authorize(${mode}) 从 HTML 解析到站点回调`);
          return { kind: 'callback', callbackUrl: trusted };
        }
      }
    }

    if (response.status === 401 || response.status === 403) {
      return {
        kind: 'fail',
        outcome: fail('NEEDS_INTERACTIVE', true, 'GitHub 拒绝了授权请求，将打开手动登录。'),
      };
    }

    return null;
  }

  private trustCallback(
    location: string,
    siteBaseUrl: string,
    state: string,
  ): string | null {
    const candidates = [
      normalizeNewApiGitHubCallbackUrl(location, siteBaseUrl, false) ?? location,
      normalizeNewApiGitHubCallbackUrl(location, siteBaseUrl, true) ?? location,
    ];
    for (const candidate of candidates) {
      const trusted = parseTrustedGitHubCallbackLocationDetailed(candidate, siteBaseUrl, state);
      if (trusted.ok) {
        return trusted.value.callbackUrl;
      }
    }
    return null;
  }

  private async tryFetch(
    url: string,
    partition: string,
    redirect: 'manual' | 'follow',
    timeoutMs = OAUTH_TIMEOUT_MS,
  ): Promise<{ ok: true; response: SessionResponse } | { ok: false; error: string }> {
    try {
      const response = await this.deps.sessionClient.fetchWithSession(url, {
        partition,
        method: 'GET',
        redirect,
        timeoutMs,
      });
      return { ok: true, response };
    } catch (error) {
      return { ok: false, error: formatError(error) };
    }
  }

  private async finishCallback(
    account: AdapterAccount,
    partition: string,
    callbackUrl: string,
  ): Promise<GitHubHeadlessOutcome> {
    let callbackBody = '';

    const spaUrl =
      normalizeNewApiGitHubCallbackUrl(callbackUrl, account.baseUrl, false) ?? callbackUrl;
    const apiUrl =
      normalizeNewApiGitHubCallbackUrl(callbackUrl, account.baseUrl, true) ?? callbackUrl;
    const candidates = spaUrl === apiUrl ? [apiUrl] : [apiUrl, spaUrl];

    try {
      let lastStatus = 0;
      let usedUrl = candidates[0];
      for (const url of candidates) {
        appLogger.info(
          `[GitHub] ③ 请求站点回调 host=${safeHost(url) ?? 'n/a'} path=${safePath(url)}`,
        );
        oauthDebug('github ③ callback request full url', url);
        const callbackResponse = await this.deps.sessionClient.fetchWithSession(url, {
          partition,
          method: 'GET',
          redirect: 'follow',
          timeoutMs: OAUTH_TIMEOUT_MS,
        });
        oauthDebug('github ③ callback response', {
          status: callbackResponse.status,
          headers: callbackResponse.headers,
          finalUrl: callbackResponse.finalUrl,
          setCookie:
            callbackResponse.headers['set-cookie'] ?? callbackResponse.headers['Set-Cookie'],
          body: callbackResponse.bodyText,
        });
        lastStatus = callbackResponse.status;
        usedUrl = url;
        if (callbackResponse.status >= 200 && callbackResponse.status < 300) {
          callbackBody = callbackResponse.bodyText;
          const bodyInfo = describeCallbackBody(callbackBody);
          appLogger.info(
            `[GitHub] ③ 回调成功 path=${safePath(url)} bodyKind=${bodyInfo.kind} bodyLen=${bodyInfo.length} extractedId=${bodyInfo.extractedId}`,
          );
          if (bodyInfo.kind === 'html' && !bodyInfo.extractedId && candidates.length > 1) {
            const next = candidates.find(c => c !== url);
            if (next) {
              appLogger.info(`[GitHub] ③ HTML 无用户 id，继续尝试另一回调路径`);
              continue;
            }
          }
          break;
        }
        appLogger.warn(
          `[GitHub] ③ 回调非 2xx status=${callbackResponse.status} path=${safePath(url)}`,
        );
      }
      if (!callbackBody) {
        appLogger.warn(
          `[GitHub] ③ 全部回调路径失败 lastStatus=${lastStatus} lastPath=${safePath(usedUrl)}`,
        );
        return fail('CALLBACK_FAILED', true, '站点 OAuth 回调失败，将尝试手动登录。');
      }
    } catch (error) {
      const detail = formatError(error);
      appLogger.warn(`[GitHub] ③ 回调网络异常: ${detail}`);
      oauthDebug('github ③ callback throw', error);
      return fail('NETWORK_ERROR', true, `站点回调失败：${shortError(detail)}`);
    }

    await this.bootstrapSiteUserId(account, callbackBody);

    let storedId = this.deps.siteIdentityStore?.getSiteUserId(account.id) ?? null;
    let hasSiteUserId = Boolean(normalizeSiteUserId(storedId));
    oauthDebug('github after bootstrap siteUserId', { storedId, hasSiteUserId });

    let authState: AuthState = 'unknown';
    if (!hasSiteUserId) {
      authState = await this.probeSessionWithoutUserHeader(account, partition);
      oauthDebug('github probe self without header', { authState });
      storedId = this.deps.siteIdentityStore?.getSiteUserId(account.id) ?? null;
      hasSiteUserId = Boolean(normalizeSiteUserId(storedId));
    }

    if (hasSiteUserId && storedId) {
      try {
        authState = await this.deps.refreshAuthState(account.id);
        oauthDebug('github refreshAuthState with uid', { authState, storedId });
      } catch (error) {
        oauthDebug('github refreshAuthState failed', error);
        authState = 'unknown';
      }
    }

    appLogger.info(
      `[GitHub] 完成 account=${account.id} authState=${authState} hasSiteUserId=${hasSiteUserId}`,
    );
    oauthDebug('github finish summary', { authState, hasSiteUserId, storedId, callbackUrl });

    if (hasSiteUserId && authState === 'active') {
      return {
        ok: true,
        authState: 'active',
        hasSiteUserId: true,
        message: 'GitHub 自动登录已完成。',
      };
    }

    if (hasSiteUserId) {
      return {
        ok: true,
        authState: authState === 'expired' ? 'unknown' : authState,
        hasSiteUserId: true,
        message: `GitHub 回调已完成并写入站内用户，会话状态：${authState}。`,
      };
    }

    return {
      ok: false,
      reason: 'CALLBACK_FAILED',
      fallbackToBrowser: true,
      message: '回调已请求但未建立有效会话/站内用户，将打开手动登录。',
    };
  }

  private async bootstrapSiteUserId(
    account: AdapterAccount,
    callbackBody: string,
  ): Promise<void> {
    const store = this.deps.siteIdentityStore;
    if (!store) {
      appLogger.warn(`[GitHub] 无 siteIdentityStore，无法持久化站内用户 ID`);
      return;
    }
    if (normalizeSiteUserId(store.getSiteUserId(account.id))) {
      return;
    }

    const fromCallback = extractSiteUserIdFromCallbackBody(callbackBody);
    oauthDebug('github extract id from callback body', { fromCallback, body: callbackBody });
    if (fromCallback) {
      store.upsertSiteIdentity(account.id, fromCallback, this.now());
      appLogger.info(`[GitHub] 已从回调 body 写入 siteUserId`);
      return;
    }
    appLogger.info(`[GitHub] 回调 body 未解析到 siteUserId，将尝试 /api/user/self`);
  }

  private async probeSessionWithoutUserHeader(
    account: AdapterAccount,
    partition: string,
  ): Promise<AuthState> {
    try {
      const selfUrl = new URL(SELF_ENDPOINT, account.baseUrl).toString();
      oauthDebug('github probe self url', selfUrl);
      const response = await this.deps.sessionClient.fetchWithSession(selfUrl, {
        partition,
        method: 'GET',
        timeoutMs: OAUTH_TIMEOUT_MS,
        bodyLimit: 512 * 1024,
      });
      oauthDebug('github probe self response', {
        status: response.status,
        headers: response.headers,
        body: response.bodyText,
      });
      appLogger.info(
        `[GitHub] self(无 New-Api-User) status=${response.status} bodyLen=${response.bodyText.length}`,
      );
      const outcome = classifyNewApiSession({
        status: response.status,
        bodyText: response.bodyText,
      });
      const store = this.deps.siteIdentityStore;
      if (store && !normalizeSiteUserId(store.getSiteUserId(account.id))) {
        const id = extractSiteUserIdFromCallbackBody(response.bodyText);
        oauthDebug('github extract id from self', id);
        if (id) {
          store.upsertSiteIdentity(account.id, id, this.now());
          appLogger.info(`[GitHub] 探测 self 时写入 siteUserId`);
        }
      }
      return outcome.state;
    } catch (error) {
      oauthDebug('github probe self throw', error);
      return 'error';
    }
  }
}

function fail(
  reason: GitHubProtocolFailureReason,
  fallbackToBrowser: boolean,
  message: string,
): GitHubHeadlessOutcome {
  return { ok: false, reason, fallbackToBrowser, message };
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function shortError(detail: string): string {
  const t = detail.trim();
  return t.length > 80 ? `${t.slice(0, 77)}…` : t;
}

function safeHost(url?: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '(invalid)';
  }
}
