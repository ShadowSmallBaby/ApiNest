/**
 * IdP 受信 host 白名单（精确匹配，不做子域通配）。
 *
 * manual 登录默认放行 GitHub + LinuxDo OAuth 域名；
 * Cookie 同步仅按 auth kind 复制对应白名单域下的 Cookie。
 */

export const GITHUB_IDP_HOSTS = ['github.com'] as const;

export const LINUXDO_IDP_HOSTS = ['connect.linux.do', 'linux.do'] as const;

/** 站点「应用内登录」默认放行的 OAuth 域名（不含纯论坛入口 linux.do）。 */
export const DEFAULT_MANUAL_OAUTH_DOMAINS: string[] = [
  GITHUB_IDP_HOSTS[0],
  'connect.linux.do',
];

export type IdpAuthKind = 'github' | 'linuxdo';

/** 按 auth kind 返回允许同步 Cookie 的 host 白名单。 */
export function hostsForAuthKind(kind: IdpAuthKind): readonly string[] {
  if (kind === 'github') {
    return GITHUB_IDP_HOSTS;
  }
  return LINUXDO_IDP_HOSTS;
}

/**
 * Cookie domain 是否归属白名单 host。
 * 允许 `github.com` 与 `.github.com`；拒绝 `evilgithub.com` / `github.com.evil.com`。
 */
export function isIdpCookieDomainAllowed(
  cookieDomain: string,
  allowedHosts: readonly string[],
): boolean {
  const normalized = cookieDomain.trim().toLowerCase().replace(/^\./, '');
  if (normalized.length === 0) {
    return false;
  }

  return allowedHosts.some(host => {
    const base = host.trim().toLowerCase();
    return normalized === base || normalized.endsWith(`.${base}`);
  });
}
