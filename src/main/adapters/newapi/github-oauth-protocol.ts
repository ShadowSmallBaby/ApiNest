/**
 * NewAPI ↔ GitHub OAuth 协议纯函数（零 Electron）。
 *
 * 流程：
 * 1. GET {site}/api/oauth/state → state
 * 2. GET https://github.com/login/oauth/authorize?client_id&state&scope=user:email
 * 3. GET {site}/oauth/github?code&state → Set-Cookie 登录态
 *
 * code/state 仅编排栈瞬态使用，绝不落库、写日志或回传 Renderer。
 */

export const GITHUB_OAUTH_ORIGIN = 'https://github.com';
export const GITHUB_OAUTH_SCOPE = 'user:email';

export type GitHubProtocolFailureReason =
  | 'STATE_FAILED'
  | 'NEEDS_INTERACTIVE'
  | 'CALLBACK_REJECTED'
  | 'CALLBACK_FAILED'
  | 'NETWORK_ERROR';

export interface GitHubOAuthUrls {
  stateUrl: string;
  authorizeUrl: string;
}

/** 由站点 baseUrl + Client ID + state 拼装协议 URL。 */
export function buildGitHubOAuthUrls(
  baseUrl: string,
  clientId: string,
  state: string,
): GitHubOAuthUrls | null {
  try {
    if (!clientId.trim() || !state.trim()) {
      return null;
    }

    const origin = new URL(baseUrl).origin;
    const stateUrl = new URL('/api/oauth/state', origin);
    stateUrl.searchParams.set('aff', '');

    const authorizeUrl = new URL('/login/oauth/authorize', GITHUB_OAUTH_ORIGIN);
    authorizeUrl.searchParams.set('client_id', clientId.trim());
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('scope', GITHUB_OAUTH_SCOPE);

    return {
      stateUrl: stateUrl.toString(),
      authorizeUrl: authorizeUrl.toString(),
    };
  } catch {
    return null;
  }
}

/**
 * 解析 `/api/oauth/state` 响应体。
 * 成功：`success === true` 且 `data` 为非空字符串。
 * 与 LinuxDo 共用同一 NewAPI 接口形态。
 */
export function parseGitHubOAuthStateResponse(bodyText: string): string | null {
  const trimmed = bodyText.trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (record.success !== true) {
      return null;
    }
    const data = record.data;
    if (typeof data !== 'string') {
      return null;
    }
    const state = data.trim();
    return state.length > 0 ? state : null;
  } catch {
    return null;
  }
}

export interface ParsedGitHubCallbackLocation {
  callbackUrl: string;
  code: string;
  state: string;
}

export type GitHubCallbackRejectReason =
  | 'empty'
  | 'bad_site_base'
  | 'bad_location_url'
  | 'bad_protocol'
  | 'host_mismatch'
  | 'path_mismatch'
  | 'missing_code'
  | 'missing_state'
  | 'state_mismatch';

export type ParseGitHubCallbackResult =
  | { ok: true; value: ParsedGitHubCallbackLocation }
  | { ok: false; reason: GitHubCallbackRejectReason; detail: string };

/**
 * 校验 GitHub 授权后的回跳是否为受信站点回调。
 *
 * 受信条件：
 * - host 与账户 baseUrl hostname 精确一致
 * - path 含 `oauth/github`（兼容 `/oauth/github` 与 `/api/oauth/github`）
 * - query 含非空 code、state，且 state 与发起值一致
 */
export function parseTrustedGitHubCallbackLocation(
  locationHeader: string,
  siteBaseUrl: string,
  expectedState: string,
): ParsedGitHubCallbackLocation | null {
  const result = parseTrustedGitHubCallbackLocationDetailed(
    locationHeader,
    siteBaseUrl,
    expectedState,
  );
  return result.ok ? result.value : null;
}

export function parseTrustedGitHubCallbackLocationDetailed(
  locationHeader: string,
  siteBaseUrl: string,
  expectedState: string,
): ParseGitHubCallbackResult {
  const location = locationHeader.trim();
  if (location.length === 0 || expectedState.trim().length === 0) {
    return { ok: false, reason: 'empty', detail: 'empty location or state' };
  }

  let siteHost: string;
  let siteOrigin: string;
  try {
    const site = new URL(siteBaseUrl);
    siteHost = site.hostname.toLowerCase();
    siteOrigin = site.origin;
  } catch {
    return { ok: false, reason: 'bad_site_base', detail: 'invalid site baseUrl' };
  }

  let callback: URL;
  try {
    callback = new URL(location, siteOrigin);
  } catch {
    return { ok: false, reason: 'bad_location_url', detail: 'unparseable location' };
  }

  if (callback.protocol !== 'https:' && callback.protocol !== 'http:') {
    return {
      ok: false,
      reason: 'bad_protocol',
      detail: `protocol=${callback.protocol}`,
    };
  }

  const callbackHost = callback.hostname.toLowerCase();
  if (callbackHost !== siteHost) {
    return {
      ok: false,
      reason: 'host_mismatch',
      detail: `locationHost=${callbackHost} expectedHost=${siteHost}`,
    };
  }

  const path = callback.pathname.toLowerCase();
  if (!path.includes('oauth/github')) {
    return {
      ok: false,
      reason: 'path_mismatch',
      detail: `path=${callback.pathname}`,
    };
  }

  const code = callback.searchParams.get('code')?.trim() ?? '';
  const state = callback.searchParams.get('state')?.trim() ?? '';
  if (code.length === 0) {
    return {
      ok: false,
      reason: 'missing_code',
      detail: `path=${callback.pathname} hasState=${state.length > 0}`,
    };
  }
  if (state.length === 0) {
    return {
      ok: false,
      reason: 'missing_state',
      detail: `path=${callback.pathname} hasCode=true`,
    };
  }
  if (state !== expectedState.trim()) {
    return {
      ok: false,
      reason: 'state_mismatch',
      detail: `path=${callback.pathname} stateLen=${state.length} expectedLen=${expectedState.trim().length}`,
    };
  }

  return {
    ok: true,
    value: {
      callbackUrl: callback.toString(),
      code,
      state,
    },
  };
}

/**
 * 将 GitHub 回跳 Location 规范为站点回调 URL。
 *
 * 常见路径为 `/oauth/github`；可选改写为 `/api/oauth/github`。
 * 统一为站点 origin（https）以保证 Secure Cookie。
 */
export function normalizeNewApiGitHubCallbackUrl(
  locationHeader: string,
  siteBaseUrl: string,
  preferApiPath = false,
): string | null {
  const location = locationHeader.trim();
  if (location.length === 0) {
    return null;
  }

  let site: URL;
  try {
    site = new URL(siteBaseUrl);
  } catch {
    return null;
  }

  let callback: URL;
  try {
    callback = new URL(location, site.origin);
  } catch {
    return null;
  }

  callback.protocol = site.protocol;
  callback.hostname = site.hostname;
  if (site.port) {
    callback.port = site.port;
  } else {
    callback.port = '';
  }

  if (preferApiPath) {
    const path = callback.pathname;
    if (/\/oauth\/github\/?$/i.test(path) && !/\/api\/oauth\/github\/?$/i.test(path)) {
      callback.pathname = path.replace(/\/oauth\/github\/?$/i, '/api/oauth/github');
    }
  }

  return callback.toString();
}

/** 是否为 GitHub 密码/登录交互页。 */
export function isGitHubPasswordLoginUrl(url: string): boolean {
  try {
    const parsed = new URL(url, GITHUB_OAUTH_ORIGIN);
    const host = parsed.hostname.toLowerCase();
    if (host !== 'github.com' && !host.endsWith('.github.com')) {
      return false;
    }
    const path = parsed.pathname.toLowerCase();
    // authorize 本身不算密码页；登录/验证页才需要交互
    if (path.startsWith('/login/oauth/authorize')) {
      return false;
    }
    return (
      path === '/login' ||
      path.startsWith('/login/') ||
      path.includes('/session') ||
      path.includes('/sessions') ||
      path.includes('/two-factor') ||
      path.includes('/auth/')
    );
  } catch {
    return false;
  }
}

/** 是否为 GitHub OAuth 应用授权/重新授权确认页。 */
export function isGitHubOAuthConsentPage(url: string): boolean {
  try {
    const parsed = new URL(url, GITHUB_OAUTH_ORIGIN);
    const host = parsed.hostname.toLowerCase();
    if (host !== 'github.com' && !host.endsWith('.github.com')) {
      return false;
    }
    const path = parsed.pathname.toLowerCase();
    return (
      path.startsWith('/login/oauth/authorize') ||
      path.includes('/login/oauth/') ||
      path.includes('/oauth/authorize') ||
      path.includes('/settings/connections/applications/')
    );
  } catch {
    return false;
  }
}

/**
 * 从 GitHub 授权确认页 HTML 提取「Authorize / 授权」表单 action。
 * 页面常见 name=authorize 的 submit 按钮，表单 POST 到 /login/oauth/authorize。
 */
export function extractGitHubAuthorizeForm(
  html: string,
): { action: string; method: string; fields: Record<string, string> } | null {
  if (!html || html.trim().length === 0) {
    return null;
  }

  // 优先找带 Authorize 按钮的 form
  const formMatch =
    /<form\b[^>]*>([\s\S]*?(?:Authorize|授权|Reauthoriz)[\s\S]*?)<\/form>/i.exec(html) ??
    /<form\b[^>]*action=["']([^"']*login\/oauth[^"']*)["'][^>]*>([\s\S]*?)<\/form>/i.exec(html);

  if (!formMatch) {
    return null;
  }

  const formTagMatch = /<form\b([^>]*)>/i.exec(formMatch[0]);
  const formAttrs = formTagMatch?.[1] ?? '';
  const actionAttr = /action=["']([^"']+)["']/i.exec(formAttrs)?.[1]?.trim();
  const methodAttr = (/method=["']([^"']+)["']/i.exec(formAttrs)?.[1] ?? 'POST').trim().toUpperCase();
  const body = formMatch[1] ?? formMatch[2] ?? formMatch[0];

  const fields: Record<string, string> = {};
  const inputRe = /<input\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = inputRe.exec(body)) !== null) {
    const attrs = m[1];
    const name = /name=["']([^"']+)["']/i.exec(attrs)?.[1];
    if (!name) continue;
    const type = (/type=["']([^"']+)["']/i.exec(attrs)?.[1] ?? 'text').toLowerCase();
    if (type === 'submit' || type === 'button' || type === 'image') {
      // submit 按钮若有 name=authorize 也要带上
      const value = /value=["']([^"']*)["']/i.exec(attrs)?.[1] ?? '';
      if (name.toLowerCase() === 'authorize' || name.toLowerCase() === 'commit') {
        fields[name] = value || '1';
      }
      continue;
    }
    const value = /value=["']([^"']*)["']/i.exec(attrs)?.[1] ?? '';
    fields[name] = value;
  }

  // 没有显式 authorize 字段时补一个（GitHub 有时靠 name=authorize 的 submit）
  if (!Object.keys(fields).some(k => k.toLowerCase() === 'authorize')) {
    fields.authorize = '1';
  }

  const action = actionAttr && actionAttr.length > 0
    ? actionAttr
    : 'https://github.com/login/oauth/authorize';

  try {
    const absolute = new URL(action, GITHUB_OAUTH_ORIGIN);
    if (absolute.hostname.toLowerCase() !== 'github.com' && !absolute.hostname.toLowerCase().endsWith('.github.com')) {
      return null;
    }
    return {
      action: absolute.toString(),
      method: methodAttr === 'GET' ? 'GET' : 'POST',
      fields,
    };
  } catch {
    return null;
  }
}

/** 是否为 GitHub OAuth 相关 host。 */
export function isGitHubOAuthHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  return h === 'github.com' || h.endsWith('.github.com');
}

export function readLocationHeader(headers: Record<string, string>): string | null {
  const value = headers.location ?? headers.Location;
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}
