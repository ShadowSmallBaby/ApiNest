import type { SessionPartitionManager } from './session-partition-manager';
import type { CookieLike, CookiesSetDetailsLike } from './session-service';
import {
  hostsForAuthKind,
  isIdpCookieDomainAllowed,
  type IdpAuthKind,
} from './idp-hosts';
import { appLogger } from '../logging/logger';
import { oauthDebug } from '../adapters/newapi/oauth-debug';

/**
 * 将已绑定 auth 身份 partition 中的 IdP Cookie 注入账户 partition。
 *
 * 安全边界（用户已授权改写原“不复制 IdP Cookie”红线）：
 *  - 仅 github/linuxdo；仅白名单 host；仅主进程内 auth → account；
 *  - 不复制站点 Cookie、不跨账户、不回传 Cookie 值到 Renderer/日志。
 */

export interface SyncLinkedIdpCookiesInput {
  accountId: string;
  authId: string;
  kind: IdpAuthKind;
}

export interface SyncLinkedIdpCookiesResult {
  /** 成功写入账户 partition 的 Cookie 条数；不含值。 */
  copied: number;
  /** 因前缀/属性无效等跳过的 Cookie 名（仅名，无值）。 */
  skipped: string[];
}

type PartitionSessions = Pick<SessionPartitionManager, 'getAccountSession' | 'getAuthSession'>;

export interface IdpCookieSyncDependencies {
  partitionManager: PartitionSessions;
  nowSeconds?: () => number;
}

function isHostPrefixCookie(name: string): boolean {
  return name.startsWith('__Host-');
}

function isSecurePrefixCookie(name: string): boolean {
  return name.startsWith('__Secure-') || name.startsWith('__Host-');
}

function cookieSetUrl(cookie: CookieLike, host: string): string {
  // __Host- / __Secure- 必须走 https
  const forceSecure = isSecurePrefixCookie(cookie.name);
  const scheme = forceSecure || cookie.secure !== false ? 'https' : 'http';
  // __Host- 强制 path=/
  const path = isHostPrefixCookie(cookie.name)
    ? '/'
    : cookie.path && cookie.path.length > 0
      ? cookie.path
      : '/';
  return `${scheme}://${host}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Chromium 对 Cookie 前缀有硬约束：
 * - `__Host-`：Secure + Path=/ + 禁止 Domain
 * - `__Secure-`：Secure + 禁止 Domain（按 Chromium set 规则）
 * 复制时若不去掉 Domain，会抛 EXCLUDE_INVALID_PREFIX 导致整次同步失败。
 */
function toSetDetails(cookie: CookieLike, host: string): CookiesSetDetailsLike {
  const hostPrefixed = isHostPrefixCookie(cookie.name);
  const securePrefixed = isSecurePrefixCookie(cookie.name);

  const details: CookiesSetDetailsLike = {
    url: cookieSetUrl(cookie, host),
    name: cookie.name,
    value: cookie.value,
    path: hostPrefixed ? '/' : cookie.path && cookie.path.length > 0 ? cookie.path : '/',
    secure: securePrefixed ? true : (cookie.secure ?? true),
    httpOnly: cookie.httpOnly ?? false,
  };

  // 带 __Host- / __Secure- 前缀时绝不写 domain
  if (!securePrefixed && cookie.domain) {
    details.domain = cookie.domain;
  }
  if (typeof cookie.expirationDate === 'number') {
    details.expirationDate = cookie.expirationDate;
  }
  if (cookie.sameSite) {
    details.sameSite = cookie.sameSite;
  }

  return details;
}

function resolveCookieHost(cookie: CookieLike, allowedHosts: readonly string[]): string | null {
  const domain = cookie.domain?.trim();
  if (!domain || !isIdpCookieDomainAllowed(domain, allowedHosts)) {
    return null;
  }
  return domain.replace(/^\./, '').toLowerCase();
}

export class IdpCookieSyncService {
  private readonly nowSeconds: () => number;

  constructor(private readonly deps: IdpCookieSyncDependencies) {
    this.nowSeconds = deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  }

  /**
   * 从 auth partition 读取 IdP Cookie，过滤后写入账户 partition。
   * 调用方应在打开站点登录窗之前 await；失败由调用方决定是否降级。
   */
  async syncLinkedIdpCookies(input: SyncLinkedIdpCookiesInput): Promise<SyncLinkedIdpCookiesResult> {
    const allowedHosts = hostsForAuthKind(input.kind);
    const source = this.deps.partitionManager.getAuthSession(input.authId);
    const target = this.deps.partitionManager.getAccountSession(input.accountId);

    const all = await source.cookies.get({});
    const now = this.nowSeconds();
    let copied = 0;
    const skipped: string[] = [];

    for (const cookie of all) {
      const host = resolveCookieHost(cookie, allowedHosts);
      if (!host) {
        continue;
      }
      if (typeof cookie.expirationDate === 'number' && cookie.expirationDate <= now) {
        skipped.push(`${cookie.name}(expired)`);
        continue;
      }
      if (!cookie.name || cookie.value === undefined) {
        continue;
      }

      try {
        await target.cookies.set(toSetDetails(cookie, host));
        copied += 1;
      } catch (error) {
        // 单条失败不阻断：GitHub 常有 __Host- 前缀 Cookie，属性不合法时跳过该条。
        const detail = error instanceof Error ? error.message : String(error);
        skipped.push(cookie.name);
        appLogger.warn(
          `[IdP Cookie] 跳过写入 name=${cookie.name} kind=${input.kind} error=${detail}`,
        );
        oauthDebug('idp cookie set failed', { name: cookie.name, error: detail });
      }
    }

    appLogger.info(
      `[IdP Cookie] 同步完成 kind=${input.kind} copied=${copied} skipped=${skipped.length}`,
    );
    return { copied, skipped };
  }
}
