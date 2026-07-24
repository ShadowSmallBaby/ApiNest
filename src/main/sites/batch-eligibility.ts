import type { AccountRecord, AuthKind, OAuthProvider, SiteRecord } from '../../shared/ipc/bridge';

/**
 * 站点广场一键登录 / 一键签到的账户筛选纯函数。
 * 供 IPC handler 与单测共用，避免业务规则散落在 handlers 内。
 */

export interface BatchLoginCandidate {
  account: AccountRecord;
  site: SiteRecord;
  identityKind: Extract<AuthKind, 'github' | 'linuxdo'>;
}

/**
 * 一键登录 eligible：
 * - 站点 enabled && autoLogin
 * - 账户 authState !== 'active'
 * - 绑定 github/linuxdo 身份，且站点已配置对应 OAuth provider
 */
export function selectBatchLoginAccountIds(input: {
  sites: SiteRecord[];
  accounts: AccountRecord[];
  /** authId → kind；未注入时无法匹配身份，全部跳过需身份的账户。 */
  identityKindById: Map<string, AuthKind>;
  /** siteId → 已配置 OAuth providers；可并入历史 linuxDoClientId。 */
  oauthProvidersBySiteId: Map<string, ReadonlySet<OAuthProvider>>;
}): string[] {
  const sitesById = new Map(input.sites.map(site => [site.id, site]));
  const eligible: string[] = [];

  for (const account of input.accounts) {
    if (!account.siteId) continue;
    const site = sitesById.get(account.siteId);
    if (!site || !site.enabled || !site.autoLogin) continue;
    if (account.authState === 'active') continue;
    if (!account.authRefId) continue;

    const kind = input.identityKindById.get(account.authRefId);
    if (kind !== 'github' && kind !== 'linuxdo') continue;

    const providers = input.oauthProvidersBySiteId.get(site.id);
    if (!providers || !providers.has(kind)) continue;

    eligible.push(account.id);
  }

  return eligible;
}

/**
 * 一键签到 eligible：
 * - 站点 enabled && autoCheckIn && 无外部签到站
 * - 账户 authState === 'active'
 * - 今日尚未 success/already_checked_in
 * - 适配器支持 checkIn（由调用方预先过滤或传入 capability 集合）
 */
export function selectBatchCheckInAccountIds(input: {
  sites: SiteRecord[];
  accounts: AccountRecord[];
  checkedInAccountIdsToday: ReadonlySet<string>;
  /** 支持签到的账户 ID 集合（由 capabilities.checkIn 预计算）。 */
  checkInCapableAccountIds: ReadonlySet<string>;
}): string[] {
  const sitesById = new Map(input.sites.map(site => [site.id, site]));
  const eligible: string[] = [];

  for (const account of input.accounts) {
    if (!account.siteId) continue;
    const site = sitesById.get(account.siteId);
    if (!site || !site.enabled || !site.autoCheckIn) continue;
    if (site.checkInSiteUrl?.trim()) continue;
    if (account.authState !== 'active') continue;
    if (input.checkedInAccountIdsToday.has(account.id)) continue;
    if (!input.checkInCapableAccountIds.has(account.id)) continue;
    eligible.push(account.id);
  }

  return eligible;
}

/** 合并 site_oauth_configs 与历史 linuxDoClientId 为 provider 集合。 */
export function resolveSiteOAuthProviders(
  site: Pick<SiteRecord, 'id' | 'linuxDoClientId'>,
  configured: ReadonlyArray<OAuthProvider>,
): Set<OAuthProvider> {
  const providers = new Set<OAuthProvider>(configured);
  if (site.linuxDoClientId?.trim()) {
    providers.add('linuxdo');
  }
  return providers;
}
