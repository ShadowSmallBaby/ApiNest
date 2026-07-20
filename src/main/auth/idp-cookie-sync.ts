import type { SessionPartitionManager } from './session-partition-manager';
import type { CookieLike, CookiesSetDetailsLike } from './session-service';
import {
  hostsForAuthKind,
  isIdpCookieDomainAllowed,
  type IdpAuthKind,
} from './idp-hosts';

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
}

type PartitionSessions = Pick<SessionPartitionManager, 'getAccountSession' | 'getAuthSession'>;

export interface IdpCookieSyncDependencies {
  partitionManager: PartitionSessions;
  nowSeconds?: () => number;
}

function cookieSetUrl(cookie: CookieLike, host: string): string {
  const scheme = cookie.secure === false ? 'http' : 'https';
  const path = cookie.path && cookie.path.length > 0 ? cookie.path : '/';
  return `${scheme}://${host}${path.startsWith('/') ? path : `/${path}`}`;
}

function toSetDetails(cookie: CookieLike, host: string): CookiesSetDetailsLike {
  const details: CookiesSetDetailsLike = {
    url: cookieSetUrl(cookie, host),
    name: cookie.name,
    value: cookie.value,
    path: cookie.path && cookie.path.length > 0 ? cookie.path : '/',
    secure: cookie.secure ?? true,
    httpOnly: cookie.httpOnly ?? false,
  };

  if (cookie.domain) {
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

    for (const cookie of all) {
      const host = resolveCookieHost(cookie, allowedHosts);
      if (!host) {
        continue;
      }
      if (typeof cookie.expirationDate === 'number' && cookie.expirationDate <= now) {
        continue;
      }
      if (!cookie.name || cookie.value === undefined) {
        continue;
      }

      await target.cookies.set(toSetDetails(cookie, host));
      copied += 1;
    }

    return { copied };
  }
}
