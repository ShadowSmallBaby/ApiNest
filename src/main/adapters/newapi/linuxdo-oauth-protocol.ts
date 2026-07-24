/**
 * NewAPI ↔ LinuxDo OAuth 协议纯函数（零 Electron）。
 *
 * 2026-07-22 主人授权改写：在已登录 IdP 会话下允许主进程代点「允许」并完成
 * 站点回调；`code`/`state` 仅编排栈瞬态使用，绝不落库、写日志或回传 Renderer。
 *
 * 流程：
 * 1. GET {site}/api/oauth/state?aff= → state
 * 2. GET connect.linux.do/oauth2/authorize?response_type=code&client_id&state
 * 3. HTML 抽取 /oauth2/approve/… 后 GET（302 Location → 站点回调）
 * 4. GET {site}/api/oauth/linuxdo?code&state → Set-Cookie session
 */

/** LinuxDo OAuth 授权 host（精确）。 */
export const LINUXDO_CONNECT_ORIGIN = 'https://connect.linux.do';

export type LinuxDoProtocolFailureReason =
  | 'STATE_FAILED'
  | 'NEEDS_INTERACTIVE'
  | 'APPROVE_FAILED'
  | 'CALLBACK_REJECTED'
  | 'CALLBACK_FAILED'
  | 'NETWORK_ERROR';

export interface LinuxDoOAuthUrls {
  stateUrl: string;
  authorizeUrl: string;
}

/** 由站点 baseUrl + Client ID + state 拼装协议 URL（不校验 state 语义）。 */
export function buildLinuxDoOAuthUrls(
  baseUrl: string,
  clientId: string,
  state: string,
): LinuxDoOAuthUrls | null {
  try {
    const origin = new URL(baseUrl).origin;
    const stateUrl = new URL('/api/oauth/state', origin);
    stateUrl.searchParams.set('aff', '');

    const authorizeUrl = new URL('/oauth2/authorize', LINUXDO_CONNECT_ORIGIN);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', clientId.trim());
    authorizeUrl.searchParams.set('state', state);

    if (!clientId.trim() || !state.trim()) {
      return null;
    }

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
 */
export function parseOAuthStateResponse(bodyText: string): string | null {
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

/**
 * 从授权页 HTML 抽取主操作「允许」链接。
 * 优先 `btn-pill-primary` + `/oauth2/approve/`；回退任意 href 含该路径的锚点。
 * 返回相对 path 或绝对 URL 字符串；无则 null。
 */
export function extractApproveHref(html: string): string | null {
  if (!html || html.trim().length === 0) {
    return null;
  }

  // 主按钮：class 含 btn-pill-primary 且 href 指向 approve。
  const primary =
    /<a\b[^>]*\bhref\s*=\s*["']([^"']*\/oauth2\/approve\/[^"']+)["'][^>]*\bclass\s*=\s*["'][^"']*btn-pill-primary[^"']*["'][^>]*>/i.exec(
      html,
    ) ??
    /<a\b[^>]*\bclass\s*=\s*["'][^"']*btn-pill-primary[^"']*["'][^>]*\bhref\s*=\s*["']([^"']*\/oauth2\/approve\/[^"']+)["'][^>]*>/i.exec(
      html,
    );

  if (primary?.[1]) {
    return primary[1].trim();
  }

  // 回退：任意 approve 锚点（仍要求 path 形态，避免误匹配）。
  const any =
    /<a\b[^>]*\bhref\s*=\s*["']([^"']*\/oauth2\/approve\/[A-Za-z0-9_-]+)["'][^>]*>/i.exec(html);
  return any?.[1]?.trim() ?? null;
}

/** 将相对 approve href 解析为 connect.linux.do 绝对 URL。 */
export function resolveApproveUrl(href: string): string | null {
  const trimmed = href.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    const url = new URL(trimmed, LINUXDO_CONNECT_ORIGIN);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return null;
    }
    if (url.hostname.toLowerCase() !== 'connect.linux.do') {
      return null;
    }
    if (!url.pathname.startsWith('/oauth2/approve/')) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export interface ParsedCallbackLocation {
  callbackUrl: string;
  code: string;
  state: string;
}

export type CallbackRejectReason =
  | 'empty'
  | 'bad_site_base'
  | 'bad_location_url'
  | 'bad_protocol'
  | 'host_mismatch'
  | 'path_mismatch'
  | 'missing_code'
  | 'missing_state'
  | 'state_mismatch';

export interface ParseCallbackResult {
  ok: true;
  value: ParsedCallbackLocation;
}

export interface ParseCallbackFailure {
  ok: false;
  reason: CallbackRejectReason;
  /** 脱敏诊断：host/path 等，绝不含 code/state 值。 */
  detail: string;
}

/**
 * 校验 approve 302 Location 是否为受信站点回调。
 *
 * 受信条件（应用内拦截，不是站点返回 403）：
 * - host 与账户 baseUrl 的 hostname **精确一致**（配置的站点 host 必须对上）
 * - path 含 `oauth/linuxdo`（兼容 `/api/oauth/linuxdo` 与带前缀部署）
 * - query 含非空 code、state，且 state 与发起值一致
 *
 * code/state 仅瞬态使用，不进日志。
 */
export function parseTrustedCallbackLocation(
  locationHeader: string,
  siteBaseUrl: string,
  expectedState: string,
): ParsedCallbackLocation | null {
  const result = parseTrustedCallbackLocationDetailed(locationHeader, siteBaseUrl, expectedState);
  return result.ok ? result.value : null;
}

/** 带拒绝原因的解析（供日志诊断）。 */
export function parseTrustedCallbackLocationDetailed(
  locationHeader: string,
  siteBaseUrl: string,
  expectedState: string,
): ParseCallbackResult | ParseCallbackFailure {
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

  // 兼容 /api/oauth/linuxdo、/prefix/api/oauth/linuxdo 等
  const path = callback.pathname.toLowerCase();
  if (!path.includes('oauth/linuxdo') && !path.endsWith('/oauth/linuxdo')) {
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
 * 授权页是否像「需要用户交互」（登录/挑战/无同意按钮）。
 * 保守：无 approve 链接即视为需要交互。
 * 注意：`/session/sso_provider` 是 Discourse→Connect 的 SSO 桥，不算「未登录死胡同」。
 */
export function looksLikeInteractiveAuthorizePage(html: string, finalUrl?: string): boolean {
  if (extractApproveHref(html) === null) {
    return true;
  }
  if (finalUrl && isLinuxDoPasswordLoginUrl(finalUrl)) {
    return true;
  }
  return false;
}

/** 受信 IdP host（论坛 + OAuth 站）。 */
export function isLinuxDoIdpHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  return h === 'connect.linux.do' || h === 'linux.do' || h.endsWith('.linux.do');
}

/**
 * 是否为需要用户亲自输密码/验证码的登录页。
 * Discourse SSO 桥 `/session/sso_provider`、`/discourse/sso_callback` 不是密码页。
 */
export function isLinuxDoPasswordLoginUrl(url: string): boolean {
  try {
    const parsed = new URL(url, 'https://connect.linux.do');
    if (!isLinuxDoIdpHost(parsed.hostname)) {
      return false;
    }
    const path = parsed.pathname.toLowerCase();
    if (path.includes('/session/sso') || path.includes('/discourse/sso') || path.includes('/oauth2/')) {
      return false;
    }
    return (
      path === '/login' ||
      path.startsWith('/login/') ||
      path.includes('/sign-in') ||
      path.includes('/signin') ||
      path.endsWith('/session') ||
      path.includes('/session/csrf')
    );
  } catch {
    return false;
  }
}

/** 是否为 Discourse ↔ Connect 的 SSO 桥路径（应自动跟随）。 */
export function isLinuxDoSsoBridgeUrl(url: string): boolean {
  try {
    const parsed = new URL(url, 'https://connect.linux.do');
    if (!isLinuxDoIdpHost(parsed.hostname)) {
      return false;
    }
    const path = parsed.pathname.toLowerCase();
    return path.includes('/session/sso') || path.includes('/discourse/sso');
  } catch {
    return false;
  }
}

/**
 * 将 Connect 回跳的 Location 规范为 NewAPI **API** 回调。
 *
 * 实测（7x.hk）：
 * - Connect 302 到 `http://站点/oauth/linuxdo?code&state`（前端 SPA 路由，仅返回 HTML）
 * - 真正换票接口是 `https://站点/api/oauth/linuxdo?code&state`（会 Set-Cookie 登录态）
 * - 站点 session Cookie 常为 Secure，http 请求带不上 Cookie
 *
 * 因此：对齐站点 origin（https）+ 把 `/oauth/linuxdo` 改写为 `/api/oauth/linuxdo`。
 */
export function normalizeNewApiLinuxDoCallbackUrl(
  locationHeader: string,
  siteBaseUrl: string,
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

  // 强制与账户站点同 host / 同 scheme（Secure Cookie 必须 https）
  callback.protocol = site.protocol;
  callback.hostname = site.hostname;
  if (site.port) {
    callback.port = site.port;
  } else {
    callback.port = '';
  }

  // SPA 路径 → API 路径（保留末尾斜杠以外的前缀）
  const path = callback.pathname;
  if (/\/oauth\/linuxdo\/?$/i.test(path) && !/\/api\/oauth\/linuxdo\/?$/i.test(path)) {
    callback.pathname = path.replace(/\/oauth\/linuxdo\/?$/i, '/api/oauth/linuxdo');
  }

  return callback.toString();
}

/**
 * 从回调 JSON 体中尽力提取站内用户 id（非凭据）。
 * 兼容 `{ data: { id } }` / `{ data: { user: { id } } }` / 顶层 `id`。
 */
export function extractSiteUserIdFromCallbackBody(bodyText: string): string | null {
  const trimmed = bodyText.trim();
  if (trimmed.length === 0) {
    return null;
  }

  // JSON 优先
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const fromJson = pickNumericId(parsed as Record<string, unknown>);
      if (fromJson) {
        return fromJson;
      }
    }
  } catch {
    // 非 JSON：继续 HTML / 宽松扫描
  }

  return extractSiteUserIdFromLooseText(trimmed);
}

/**
 * 从 HTML/内联脚本等宽松文本中提取站内用户 ID（仅数字 id，非凭据）。
 * 用于 OAuth 回调返回前端页而非纯 JSON 的部署。
 */
export function extractSiteUserIdFromLooseText(text: string): string | null {
  if (!text || text.length === 0) {
    return null;
  }

  // 常见内嵌： "id": 12345 / "user_id":"123" / localStorage uid
  const patterns = [
    /"id"\s*:\s*(\d{1,15})\b/,
    /"user_id"\s*:\s*"?(\d{1,15})\b/,
    /"userId"\s*:\s*"?(\d{1,15})\b/,
    /"uid"\s*:\s*"?(\d{1,15})\b/,
    /\buser\.id\s*=\s*(\d{1,15})\b/i,
    /localStorage\.setItem\(\s*['"]uid['"]\s*,\s*['"]?(\d{1,15})/,
  ];

  for (const re of patterns) {
    const m = re.exec(text);
    if (m?.[1]) {
      const id = normalizePositiveIntId(m[1]);
      if (id) {
        return id;
      }
    }
  }
  return null;
}

/** 回调体形态诊断（不含正文）。 */
export function describeCallbackBody(bodyText: string): {
  kind: 'empty' | 'json' | 'html' | 'text';
  length: number;
  jsonSuccess?: boolean;
  extractedId: boolean;
} {
  const trimmed = bodyText.trim();
  if (trimmed.length === 0) {
    return { kind: 'empty', length: 0, extractedId: false };
  }
  const extractedId = extractSiteUserIdFromCallbackBody(trimmed) !== null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      return {
        kind: 'json',
        length: trimmed.length,
        jsonSuccess: parsed.success === true || parsed.success === false ? Boolean(parsed.success) : undefined,
        extractedId,
      };
    } catch {
      return { kind: 'text', length: trimmed.length, extractedId };
    }
  }
  if (/<html[\s>]|<body[\s>]/i.test(trimmed)) {
    return { kind: 'html', length: trimmed.length, extractedId };
  }
  return { kind: 'text', length: trimmed.length, extractedId };
}

function pickNumericId(record: Record<string, unknown>): string | null {
  const direct = normalizePositiveIntId(record.id);
  if (direct) {
    return direct;
  }

  // 部分部署用 user_id / uid
  const alt = normalizePositiveIntId(record.user_id ?? record.userId ?? record.uid);
  if (alt) {
    return alt;
  }

  const data = record.data;
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const dataRec = data as Record<string, unknown>;
    const fromData = normalizePositiveIntId(dataRec.id ?? dataRec.user_id ?? dataRec.userId);
    if (fromData) {
      return fromData;
    }
    const user = dataRec.user;
    if (typeof user === 'object' && user !== null && !Array.isArray(user)) {
      return normalizePositiveIntId((user as Record<string, unknown>).id);
    }
  }

  const user = record.user;
  if (typeof user === 'object' && user !== null && !Array.isArray(user)) {
    return normalizePositiveIntId((user as Record<string, unknown>).id);
  }

  return null;
}

function normalizePositiveIntId(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }
  if (typeof value === 'string') {
    const t = value.trim();
    if (!/^\d+$/.test(t)) {
      return null;
    }
    const n = Number(t);
    return Number.isSafeInteger(n) && n > 0 ? t : null;
  }
  return null;
}

/** 从响应头字典读取 Location（键已小写）。 */
export function readLocationHeader(headers: Record<string, string>): string | null {
  const value = headers.location ?? headers.Location;
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** HTTP 状态是否为 3xx 重定向。 */
export function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}
