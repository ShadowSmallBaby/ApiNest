/**
 * 受控内嵌浏览器容器的导航安全策略（纯函数，无 Electron 依赖）。
 *
 * 默认拒绝一切：仅放行 http/https 且 host 精确命中允许集的导航；
 * window.open 与页内导航共用允许 host 集；容器层对允许目标做同窗导航，
 * 权限请求、下载与外部协议默认拒绝。host 采用精确匹配，
 * 不做通配或后缀宽松匹配，避免 `evil-example.com` 混入 `example.com` 允许集。
 */

export interface AllowedNavigationContext {
  /** 账户目标站点。 */
  baseUrl: string;
  /** 已配置 OAuth 域名（本轮通常为空，7.x LinuxDo 阶段按需填充）。 */
  oauthDomains?: string[];
  /** 已确认的回跳域名（本轮通常为空）。 */
  redirectDomains?: string[];
}

export interface NavigationDecision {
  allowed: boolean;
  reason: string;
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase();
}

function safeParseUrl(targetUrl: string): URL | null {
  try {
    return new URL(targetUrl);
  } catch {
    return null;
  }
}

/** 由 baseUrl 与可选 OAuth/回跳域名构建精确匹配的允许 host 集合。 */
export function buildAllowedHosts(context: AllowedNavigationContext): Set<string> {
  const hosts = new Set<string>();

  const base = safeParseUrl(context.baseUrl);
  if (base) {
    hosts.add(normalizeHost(base.hostname));
  }

  for (const domain of [...(context.oauthDomains ?? []), ...(context.redirectDomains ?? [])]) {
    const normalized = normalizeHost(domain);
    if (normalized.length > 0) {
      hosts.add(normalized);
    }
  }

  return hosts;
}

/** 判定一次页内导航是否放行。 */
export function decideNavigation(
  targetUrl: string,
  context: AllowedNavigationContext,
): NavigationDecision {
  const parsed = safeParseUrl(targetUrl);
  if (!parsed) {
    return { allowed: false, reason: 'Invalid navigation URL.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { allowed: false, reason: `Blocked non-web protocol: ${parsed.protocol}` };
  }

  const allowedHosts = buildAllowedHosts(context);
  if (!allowedHosts.has(normalizeHost(parsed.hostname))) {
    return { allowed: false, reason: `Navigation to disallowed host: ${parsed.hostname}` };
  }

  return { allowed: true, reason: 'Host is in the allowed set.' };
}

/**
 * window.open 与页内导航共用允许集。
 * 容器层在 allowed 时仍应拒绝真正新开窗口，改为同窗 loadURL，避免无守卫子窗。
 */
export function decideWindowOpen(
  targetUrl: string,
  context: AllowedNavigationContext,
): NavigationDecision {
  const navigation = decideNavigation(targetUrl, context);
  if (!navigation.allowed) {
    return { allowed: false, reason: `Blocked window.open for: ${targetUrl}` };
  }

  return { allowed: true, reason: 'window.open target is in the allowed set; handle as same-window navigation.' };
}

/** 所有权限请求默认拒绝。 */
export function decidePermission(permission: string): NavigationDecision {
  return { allowed: false, reason: `Denied permission request: ${permission}` };
}

/** 下载默认拒绝。 */
export function isDownloadAllowed(): boolean {
  return false;
}

/** 非 http/https 一律视为外部协议（mailto、tel、自定义 scheme 等）。 */
export function isExternalProtocol(targetUrl: string): boolean {
  const parsed = safeParseUrl(targetUrl);
  if (!parsed) {
    return false;
  }

  return parsed.protocol !== 'http:' && parsed.protocol !== 'https:';
}
