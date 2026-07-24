/**
 * LinuxDo 无头 OAuth 编排（主进程 session.fetch，账户 partition）。
 *
 * 2026-07-22 主人授权：在已同步 IdP Cookie 的前提下，自动完成 state → authorize →
 * approve → 站点回调；code 仅瞬态，不落库/不日志。失败可降级受控窗口。
 *
 * Chromium 注意：`session.fetch({ redirect: 'manual' })` 遇到 3xx 时经常直接抛错
 *（而非返回 status），因此 authorize/approve 采用「manual 优先 + follow 回退」。
 */

import type { AdapterAccount } from '../../../shared/domain/platform-adapter';
import type { AuthState } from '../../../shared/ipc/bridge';
import { getAccountPartition } from '../../auth/account-partition';
import type { SessionRequestClient, SessionResponse } from '../session-request-client';
import { resolveLinuxDoOAuthPlan } from './linuxdo-oauth';
import {
  buildLinuxDoOAuthUrls,
  describeCallbackBody,
  extractApproveHref,
  extractSiteUserIdFromCallbackBody,
  isLinuxDoPasswordLoginUrl,
  isLinuxDoSsoBridgeUrl,
  isRedirectStatus,
  looksLikeInteractiveAuthorizePage,
  parseOAuthStateResponse,
  normalizeNewApiLinuxDoCallbackUrl,
  parseTrustedCallbackLocationDetailed,
  readLocationHeader,
  resolveApproveUrl,
  type LinuxDoProtocolFailureReason,
} from './linuxdo-oauth-protocol';
import { classifyNewApiSession } from './session';
import { normalizeSiteUserId } from './newapi-site-identity';
import type { SiteIdentityStore } from './newapi-browser-identity-capture';
import { appLogger } from '../../logging/logger';
import { oauthDebug } from './oauth-debug';

export type LinuxDoHeadlessOutcome =
  | {
      ok: true;
      authState: AuthState;
      /** 是否已写入站内用户 ID。 */
      hasSiteUserId: boolean;
      message: string;
    }
  | {
      ok: false;
      reason: LinuxDoProtocolFailureReason;
      /** true 时 LoginFlowService 应打开受控窗口。 */
      fallbackToBrowser: boolean;
      message: string;
    };

export interface LinuxDoHeadlessLoginDependencies {
  sessionClient: SessionRequestClient;
  siteIdentityStore?: SiteIdentityStore;
  refreshAuthState: (accountId: string) => Promise<AuthState>;
  now?: () => string;
}

const SELF_ENDPOINT = '/api/user/self';
/** authorize / approve 跨境可能较慢。 */
const OAUTH_TIMEOUT_MS = 20_000;

export class LinuxDoHeadlessLogin {
  private readonly now: () => string;

  constructor(private readonly deps: LinuxDoHeadlessLoginDependencies) {
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  async run(account: AdapterAccount): Promise<LinuxDoHeadlessOutcome> {
    const plan = resolveLinuxDoOAuthPlan(account);
    if (!plan) {
      appLogger.info(`[LinuxDo] 无 plan，跳过 account=${account.id}`);
      return {
        ok: false,
        reason: 'STATE_FAILED',
        fallbackToBrowser: false,
        message: '当前账户未配置可用的 LinuxDo 登录。',
      };
    }

    const partition = getAccountPartition(account.id);
    appLogger.info(`[LinuxDo] 开始无头登录 account=${account.id} site=${plan.siteOrigin}`);
    oauthDebug('run start', {
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
      appLogger.info(`[LinuxDo] ① 请求 OAuth state`);
      const stateResponse = await this.deps.sessionClient.fetchWithSession(plan.stateUrl.toString(), {
        partition,
        method: 'GET',
        timeoutMs: OAUTH_TIMEOUT_MS,
      });
      oauthDebug('① state raw', {
        status: stateResponse.status,
        headers: stateResponse.headers,
        body: stateResponse.bodyText,
      });
      const parsed = parseOAuthStateResponse(stateResponse.bodyText);
      if (stateResponse.status < 200 || stateResponse.status >= 300 || !parsed) {
        appLogger.warn(
          `[LinuxDo] ① state 失败 status=${stateResponse.status} bodyLen=${stateResponse.bodyText.length}`,
        );
        return fail('STATE_FAILED', true, '未能从站点获取 OAuth state，将尝试手动登录。');
      }
      state = parsed;
      appLogger.info(`[LinuxDo] ① state 成功 len=${state.length}`);
      oauthDebug('① state value', state);
    } catch (error) {
      const detail = formatError(error);
      appLogger.warn(`[LinuxDo] ① state 网络异常: ${detail}`);
      return fail('NETWORK_ERROR', true, `请求 OAuth state 失败：${shortError(detail)}`);
    }

    const urls = buildLinuxDoOAuthUrls(account.baseUrl, plan.clientId, state);
    if (!urls) {
      appLogger.warn(`[LinuxDo] 无法组装 authorize URL`);
      return fail('STATE_FAILED', true, '无法组装 LinuxDo 授权地址，将尝试手动登录。');
    }
    oauthDebug('built urls', urls);

    // 2) authorize → HTML 或直接回调
    appLogger.info(`[LinuxDo] ② 打开 authorize host=connect.linux.do`);
    const authorizeStep = await this.resolveAuthorize(account, partition, urls.authorizeUrl, state);
    if (authorizeStep.kind === 'fail') {
      return authorizeStep.outcome;
    }
    if (authorizeStep.kind === 'callback') {
      return this.finishCallback(account, partition, authorizeStep.callbackUrl);
    }

    // 3) approve
    const approveHref = extractApproveHref(authorizeStep.html);
    const approveUrl = approveHref ? resolveApproveUrl(approveHref) : null;
    oauthDebug('approve link', { approveHref, approveUrl, htmlSnippet: authorizeStep.html.slice(0, 2000) });
    if (!approveUrl) {
      appLogger.warn(`[LinuxDo] ② 未找到「允许」链接`);
      return fail('NEEDS_INTERACTIVE', true, '未找到「允许」按钮，将打开手动登录。');
    }
    appLogger.info(`[LinuxDo] ③ 找到同意链接`);

    const approveStep = await this.resolveApprove(account, partition, approveUrl, state);
    if (approveStep.kind === 'fail') {
      return approveStep.outcome;
    }

    oauthDebug('approve callbackUrl (full)', approveStep.callbackUrl);

    // 4) 站点回调
    return this.finishCallback(account, partition, approveStep.callbackUrl);
  }

  /**
   * 拉取授权页。
   *
   * Connect 未建会话时，authorize 会 302 到 linux.do `/session/sso_provider`（Discourse SSO 桥），
   * 再经 sso_callback 回到 connect。这是**可自动跟随**的桥接，不是密码登录死胡同。
   * 只有真正落到密码登录页才 NEEDS_INTERACTIVE。
   */
  private async resolveAuthorize(
    account: AdapterAccount,
    partition: string,
    authorizeUrl: string,
    state: string,
  ): Promise<
    | { kind: 'html'; html: string }
    | { kind: 'callback'; callbackUrl: string }
    | { kind: 'fail'; outcome: LinuxDoHeadlessOutcome }
  > {
    // 先 follow：一次走完 Discourse SSO 桥（论坛已登录时会自动建 connect 会话）。
    const followed = await this.tryFetch(authorizeUrl, partition, 'follow');
    if (followed.ok) {
      appLogger.info(
        `[LinuxDo] ② authorize(follow) status=${followed.response.status} bodyLen=${followed.response.bodyText.length} finalHost=${safeHost(followed.response.finalUrl) ?? 'n/a'}`,
      );
      const fromFollow = this.interpretAuthorizeResponse(
        followed.response,
        account.baseUrl,
        state,
        'follow',
      );
      if (fromFollow) {
        return fromFollow;
      }
      appLogger.warn(`[LinuxDo] ② follow 未得到授权页，尝试 manual 探测`);
    } else {
      appLogger.warn(`[LinuxDo] ② authorize(follow) 异常: ${followed.error}`);
    }

    // follow 失败时用 manual 看第一跳（日志诊断用），再视情况 fail。
    const manual = await this.tryFetch(authorizeUrl, partition, 'manual');
    if (manual.ok) {
      const location = readLocationHeader(manual.response.headers) ?? manual.response.finalUrl;
      appLogger.info(
        `[LinuxDo] ② authorize(manual) status=${manual.response.status} toHost=${safeHost(location) ?? 'n/a'}`,
      );
      if (location && isLinuxDoPasswordLoginUrl(location)) {
        return {
          kind: 'fail',
          outcome: fail('NEEDS_INTERACTIVE', true, 'LinuxDo 尚未登录，请先在「认证身份」中登录 LinuxDo（含 connect）。'),
        };
      }
      if (location && isLinuxDoSsoBridgeUrl(location)) {
        // 桥接跳转：再 follow 一次从桥接 URL 继续（Cookie 已带上）。
        appLogger.info(`[LinuxDo] ② 检测到 Discourse SSO 桥，跟随桥接`);
        const bridgeFollow = await this.tryFetch(location, partition, 'follow');
        if (bridgeFollow.ok) {
          appLogger.info(
            `[LinuxDo] ② SSO 桥 follow status=${bridgeFollow.response.status} finalHost=${safeHost(bridgeFollow.response.finalUrl) ?? 'n/a'}`,
          );
          const fromBridge = this.interpretAuthorizeResponse(
            bridgeFollow.response,
            account.baseUrl,
            state,
            'follow',
          );
          if (fromBridge) {
            return fromBridge;
          }
        } else {
          appLogger.warn(`[LinuxDo] ② SSO 桥 follow 失败: ${bridgeFollow.error}`);
        }
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
    } else {
      appLogger.warn(`[LinuxDo] ② authorize(manual) 失败: ${manual.error}`);
    }

    return {
      kind: 'fail',
      outcome: fail(
        'NEEDS_INTERACTIVE',
        true,
        '无法完成 LinuxDo 授权页（可能需先在认证身份中登录 connect.linux.do），将打开手动登录。',
      ),
    };
  }

  private interpretAuthorizeResponse(
    response: SessionResponse,
    siteBaseUrl: string,
    state: string,
    mode: 'manual' | 'follow',
  ):
    | { kind: 'html'; html: string }
    | { kind: 'callback'; callbackUrl: string }
    | { kind: 'fail'; outcome: LinuxDoHeadlessOutcome }
    | null {
    // 3xx + Location
    if (isRedirectStatus(response.status)) {
      const location = readLocationHeader(response.headers);
      if (location && isLinuxDoPasswordLoginUrl(location)) {
        return {
          kind: 'fail',
          outcome: fail(
            'NEEDS_INTERACTIVE',
            true,
            'LinuxDo 尚未登录，请先在「认证身份」中登录 LinuxDo（含 connect）。',
          ),
        };
      }
      // SSO 桥：manual 不在这里 follow，交给 resolveAuthorize 上层处理 → 返回 null 触发后续。
      if (location && isLinuxDoSsoBridgeUrl(location)) {
        appLogger.info(`[LinuxDo] ② authorize(${mode}) 命中 SSO 桥 toHost=${safeHost(location)}`);
        return null;
      }
      if (location) {
        const callback = parseTrustedCallbackLocationDetailed(location, siteBaseUrl, state);
        if (callback.ok) {
          appLogger.info(`[LinuxDo] ② authorize(${mode}) 直接回跳站点回调`);
          return { kind: 'callback', callbackUrl: callback.value.callbackUrl };
        }
      }
      return null;
    }

    // follow 后的最终 URL
    if (response.finalUrl) {
      if (isLinuxDoPasswordLoginUrl(response.finalUrl)) {
        return {
          kind: 'fail',
          outcome: fail(
            'NEEDS_INTERACTIVE',
            true,
            'LinuxDo 尚未登录，请先在「认证身份」中登录 LinuxDo（含 connect）。',
          ),
        };
      }
      const callback = parseTrustedCallbackLocationDetailed(response.finalUrl, siteBaseUrl, state);
      if (callback.ok) {
        appLogger.info(`[LinuxDo] ② authorize(${mode}) finalUrl 已是站点回调`);
        return { kind: 'callback', callbackUrl: callback.value.callbackUrl };
      }
    }

    if (response.status === 401 || response.status === 403) {
      return {
        kind: 'fail',
        outcome: fail('NEEDS_INTERACTIVE', true, 'LinuxDo 拒绝了授权请求，将打开手动登录。'),
      };
    }

    if (response.status < 200 || response.status >= 300) {
      return null;
    }

    if (looksLikeInteractiveAuthorizePage(response.bodyText, response.finalUrl)) {
      return {
        kind: 'fail',
        outcome: fail('NEEDS_INTERACTIVE', true, '需要在 LinuxDo 完成登录或确认，将打开手动窗口。'),
      };
    }

    if (!extractApproveHref(response.bodyText)) {
      return null;
    }

    appLogger.info(`[LinuxDo] ② 授权页 HTML 可解析（${mode}）`);
    return { kind: 'html', html: response.bodyText };
  }

  /**
   * approve 必须用 manual 拿到 Location 后再由本进程对站点回调发一次 GET。
   * 绝不能 follow approve：否则 code 在 fetch 链里被消费，且 finalUrl 常丢失，站点返回 400。
   * （session.fetch manual 会抛 Redirect was cancelled；客户端已改用 net.request 捕获 302。）
   */
  private async resolveApprove(
    account: AdapterAccount,
    partition: string,
    approveUrl: string,
    state: string,
  ): Promise<
    | { kind: 'callback'; callbackUrl: string }
    | { kind: 'fail'; outcome: LinuxDoHeadlessOutcome }
  > {
    const manual = await this.tryFetch(approveUrl, partition, 'manual');
    if (!manual.ok) {
      appLogger.warn(`[LinuxDo] ③ approve(manual) 失败: ${manual.error}`);
      return {
        kind: 'fail',
        outcome: fail(
          'NETWORK_ERROR',
          true,
          `同意授权请求失败：${shortError(manual.error)}`,
        ),
      };
    }

    const response = manual.response;
    const location =
      readLocationHeader(response.headers) ??
      (response.finalUrl && response.finalUrl !== approveUrl ? response.finalUrl : null);

    appLogger.info(
      `[LinuxDo] ③ approve(manual) status=${response.status} hasLocation=${Boolean(location)} toHost=${safeHost(location ?? undefined) ?? 'n/a'}`,
    );

    if (location && (isRedirectStatus(response.status) || response.status === 0 || location.length > 0)) {
      if (isLinuxDoPasswordLoginUrl(location)) {
        return {
          kind: 'fail',
          outcome: fail('NEEDS_INTERACTIVE', true, '同意后仍需 LinuxDo 登录，将打开手动窗口。'),
        };
      }
      // Connect 常回跳 http://站点/oauth/linuxdo（SPA）；必须改写为 https://站点/api/oauth/linuxdo 才能换票写 Cookie。
      const normalized =
        normalizeNewApiLinuxDoCallbackUrl(location, account.baseUrl) ?? location;
      oauthDebug('③ approve Location', {
        raw: location,
        normalized,
        status: response.status,
        expectedState: state,
        siteBaseUrl: account.baseUrl,
      });
      appLogger.info(
        `[LinuxDo] ③ approve Location host=${safeHost(normalized) ?? 'n/a'} path=${safePath(normalized)}`,
      );
      if (isLinuxDoPasswordLoginUrl(location) || isLinuxDoPasswordLoginUrl(normalized)) {
        return {
          kind: 'fail',
          outcome: fail('NEEDS_INTERACTIVE', true, '同意后仍需 LinuxDo 登录，将打开手动窗口。'),
        };
      }
      const trusted = parseTrustedCallbackLocationDetailed(normalized, account.baseUrl, state);
      oauthDebug('③ trust parse', trusted);
      if (trusted.ok) {
        appLogger.info(`[LinuxDo] ③ approve 成功，进入 API 回调`);
        return { kind: 'callback', callbackUrl: trusted.value.callbackUrl };
      }
      appLogger.warn(
        `[LinuxDo] ③ 回调校验未通过 reason=${trusted.reason} ${trusted.detail}`,
      );
      const soft =
        trusted.reason === 'path_mismatch' ||
        trusted.reason === 'missing_code' ||
        trusted.reason === 'missing_state' ||
        trusted.reason === 'state_mismatch';
      return {
        kind: 'fail',
        outcome: fail(
          'CALLBACK_REJECTED',
          soft,
          soft
            ? `回调校验失败（${trusted.reason}），将打开手动登录。`
            : `回调地址不受信（${trusted.reason}），已中止自动登录。`,
        ),
      };
    }

    // 极端：无 302 但 2xx HTML（不应出现）
    if (response.status >= 200 && response.status < 300) {
      appLogger.warn(`[LinuxDo] ③ approve 返回 ${response.status} 但无 Location`);
    }

    return {
      kind: 'fail',
      outcome: fail('APPROVE_FAILED', true, '同意授权后未得到可信回跳，将尝试手动登录。'),
    };
  }

  private async tryFetch(
    url: string,
    partition: string,
    redirect: 'manual' | 'follow',
  ): Promise<{ ok: true; response: SessionResponse } | { ok: false; error: string }> {
    try {
      const response = await this.deps.sessionClient.fetchWithSession(url, {
        partition,
        method: 'GET',
        redirect,
        timeoutMs: OAUTH_TIMEOUT_MS,
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
  ): Promise<LinuxDoHeadlessOutcome> {
    let callbackBody = '';

    // approve 返回的 Location 必须由本进程显式 GET，才能把站点 Set-Cookie 写入账户 partition。
    // 旧逻辑误用「/api/oauth/linuxdo」严格前缀，站点若路径略有差异会跳过请求 → 无 session。
    const isOAuthCallback = isNewApiLinuxDoCallbackPath(callbackUrl);
    if (!isOAuthCallback) {
      appLogger.warn(
        `[LinuxDo] ④ 回调 URL 非 OAuth 回调 path=${safePath(callbackUrl)}，仍尝试请求一次`,
      );
    }

    try {
      appLogger.info(
        `[LinuxDo] ④ 请求站点回调 host=${safeHost(callbackUrl) ?? 'n/a'} path=${safePath(callbackUrl)}`,
      );
      oauthDebug('④ callback request full url', callbackUrl);
      const callbackResponse = await this.deps.sessionClient.fetchWithSession(callbackUrl, {
        partition,
        method: 'GET',
        redirect: 'follow',
        timeoutMs: OAUTH_TIMEOUT_MS,
      });
      oauthDebug('④ callback response', {
        status: callbackResponse.status,
        headers: callbackResponse.headers,
        finalUrl: callbackResponse.finalUrl,
        body: callbackResponse.bodyText,
      });
      if (callbackResponse.status < 200 || callbackResponse.status >= 300) {
        appLogger.warn(`[LinuxDo] ④ 回调失败 status=${callbackResponse.status}`);
        return fail('CALLBACK_FAILED', true, '站点 OAuth 回调失败，将尝试手动登录。');
      }
      callbackBody = callbackResponse.bodyText;
      const bodyInfo = describeCallbackBody(callbackBody);
      appLogger.info(
        `[LinuxDo] ④ 回调成功 status=${callbackResponse.status} bodyKind=${bodyInfo.kind} bodyLen=${bodyInfo.length} extractedId=${bodyInfo.extractedId}`,
      );
    } catch (error) {
      const detail = formatError(error);
      appLogger.warn(`[LinuxDo] ④ 回调网络异常: ${detail}`);
      oauthDebug('④ callback throw', error);
      return fail('NETWORK_ERROR', true, `站点回调失败：${shortError(detail)}`);
    }

    await this.bootstrapSiteUserId(account, partition, callbackBody);

    let storedId = this.deps.siteIdentityStore?.getSiteUserId(account.id) ?? null;
    let hasSiteUserId = Boolean(normalizeSiteUserId(storedId));
    oauthDebug('after bootstrap siteUserId', { storedId, hasSiteUserId });

    // 回调 JSON 已含 id 时直接带 New-Api-User 校验；否则用 Cookie 探测 self 再取 id。
    // 注意：部分 NewAPI 部署在「已登录但未带 New-Api-User」时也返回 401（文案不同），
    // 不能仅凭无头 self 失败断定会话无效。
    let authState: AuthState = 'unknown';
    if (!hasSiteUserId) {
      authState = await this.probeSessionWithoutUserHeader(account, partition);
      oauthDebug('probe self without header', { authState });
      storedId = this.deps.siteIdentityStore?.getSiteUserId(account.id) ?? null;
      hasSiteUserId = Boolean(normalizeSiteUserId(storedId));
    }

    if (hasSiteUserId && storedId) {
      try {
        authState = await this.deps.refreshAuthState(account.id);
        oauthDebug('refreshAuthState with uid', { authState, storedId });
      } catch (error) {
        oauthDebug('refreshAuthState failed', error);
        authState = 'unknown';
      }
    }

    appLogger.info(
      `[LinuxDo] 完成 account=${account.id} authState=${authState} hasSiteUserId=${hasSiteUserId}`,
    );
    oauthDebug('finish summary', { authState, hasSiteUserId, storedId, callbackUrl });

    if (hasSiteUserId && authState === 'active') {
      return {
        ok: true,
        authState: 'active',
        hasSiteUserId: true,
        message: 'LinuxDo 自动登录已完成。',
      };
    }

    if (hasSiteUserId) {
      return {
        ok: true,
        authState: authState === 'expired' ? 'unknown' : authState,
        hasSiteUserId: true,
        message: `LinuxDo 回调已完成并写入站内用户，会话状态：${authState}。`,
      };
    }

    return {
      ok: false,
      reason: 'CALLBACK_FAILED',
      fallbackToBrowser: true,
      message: '回调已请求但未建立有效会话/站内用户，将打开手动登录。',
    };
  }

  /**
   * 从回调 body 或 /api/user/self 引导站内用户 ID。
   */
  private async bootstrapSiteUserId(
    account: AdapterAccount,
    _partition: string,
    callbackBody: string,
  ): Promise<void> {
    const store = this.deps.siteIdentityStore;
    if (!store) {
      appLogger.warn(`[LinuxDo] 无 siteIdentityStore，无法持久化站内用户 ID`);
      return;
    }
    if (normalizeSiteUserId(store.getSiteUserId(account.id))) {
      return;
    }

    const fromCallback = extractSiteUserIdFromCallbackBody(callbackBody);
    oauthDebug('extract id from callback body', { fromCallback, body: callbackBody });
    if (fromCallback) {
      store.upsertSiteIdentity(account.id, fromCallback, this.now());
      appLogger.info(`[LinuxDo] 已从回调 body 写入 siteUserId`);
      return;
    }
    appLogger.info(`[LinuxDo] 回调 body 未解析到 siteUserId，尝试 /api/user/self`);
  }

  /**
   * 仅用 Cookie 探测 /api/user/self（不带 New-Api-User）。
   * 主人：OAuth 回调成功后只有 CK，用 CK 调 self 拿 userid。
   */
  private async probeSessionWithoutUserHeader(
    account: AdapterAccount,
    partition: string,
  ): Promise<AuthState> {
    try {
      const selfUrl = new URL(SELF_ENDPOINT, account.baseUrl).toString();
      oauthDebug('probe self url', selfUrl);
      const response = await this.deps.sessionClient.fetchWithSession(selfUrl, {
        partition,
        method: 'GET',
        timeoutMs: OAUTH_TIMEOUT_MS,
        bodyLimit: 512 * 1024,
      });
      oauthDebug('probe self response', {
        status: response.status,
        headers: response.headers,
        body: response.bodyText,
      });
      appLogger.info(
        `[LinuxDo] self(无 New-Api-User) status=${response.status} bodyLen=${response.bodyText.length}`,
      );
      const outcome = classifyNewApiSession({
        status: response.status,
        bodyText: response.bodyText,
      });
      const store = this.deps.siteIdentityStore;
      if (store && !normalizeSiteUserId(store.getSiteUserId(account.id))) {
        const id = extractSiteUserIdFromCallbackBody(response.bodyText);
        oauthDebug('extract id from self', id);
        if (id) {
          store.upsertSiteIdentity(account.id, id, this.now());
          appLogger.info(`[LinuxDo] 探测 self 时写入 siteUserId`);
        }
      }
      return outcome.state;
    } catch (error) {
      oauthDebug('probe self throw', error);
      return 'error';
    }
  }
}

function fail(
  reason: LinuxDoProtocolFailureReason,
  fallbackToBrowser: boolean,
  message: string,
): LinuxDoHeadlessOutcome {
  return { ok: false, reason, fallbackToBrowser, message };
}

function safeHost(url: string | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).host;
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

/** 是否为 NewAPI LinuxDo OAuth 回调路径（与 parseTrustedCallback 对齐）。 */
function isNewApiLinuxDoCallbackPath(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().includes('oauth/linuxdo');
  } catch {
    return false;
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

/** UI/日志用短错误，去掉可能过长的堆栈噪声。 */
function shortError(detail: string): string {
  const first = detail.split('\n')[0]?.trim() ?? detail;
  return first.length > 160 ? `${first.slice(0, 160)}…` : first;
}

/** 测试辅助：构造可预设响应序列的 SessionRequestClient。 */
export function createScriptedSessionClient(
  script: Array<SessionResponse | Error>,
): { client: SessionRequestClient; urls: string[] } {
  const urls: string[] = [];
  let index = 0;
  const client: SessionRequestClient = {
    async fetchWithSession(url: string): Promise<SessionResponse> {
      urls.push(url);
      const next = script[index];
      index += 1;
      if (!next) {
        throw new Error('Unexpected extra session request.');
      }
      if (next instanceof Error) {
        throw next;
      }
      return next;
    },
  };
  return { client, urls };
}
