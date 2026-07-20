import type { AccountRecord, AuthState, SiteRecord } from '../../../../shared/ipc/bridge';

export interface SiteCardView {
  accountCount: number;
  active: number;
  expired: number;
  error: number;
  unknown: number;
}

export function buildSiteCardView(site: SiteRecord, accounts: AccountRecord[]): SiteCardView {
  const siteAccounts = accounts.filter(account => account.siteId === site.id);
  const count = (state: AuthState): number => siteAccounts.filter(account => account.authState === state).length;
  return {
    accountCount: siteAccounts.length,
    active: count('active'),
    expired: count('expired'),
    error: count('error'),
    unknown: count('unknown'),
  };
}

export function routeProfileLabel(site: SiteRecord): string {
  if (site.platform !== 'newapi') return '平台默认路由';
  if (site.routeProfile === 'modern') return '新版 UI';
  if (site.routeProfile === 'classic') return '兼容旧版 UI';
  return '历史 Panel 路由';
}
