import type { AccountRecord, AuthState, PlatformType, SiteRecord, SiteSummary } from '../../../../shared/ipc/bridge';

/** 站点整体状态：突出需要关注的问题，优先级 error > expired > active > unknown。 */
export type SiteOverallStatus = 'active' | 'expired' | 'error' | 'unknown';

export interface SiteCardView {
  accountCount: number;
  active: number;
  expired: number;
  error: number;
  unknown: number;
  /** 该站点账户余额合计；无任何有效余额快照时为 null（不伪造 0）。 */
  balanceTotal: number | null;
  /** 今日已签到的去重账号数（分子），分母用 accountCount。 */
  checkedInToday: number;
  /** 站点级状态指示，用于卡片状态圆点。 */
  overallStatus: SiteOverallStatus;
}

/** 由账户 authState 分桶推导站点整体状态；无账户时为 unknown。 */
function deriveOverallStatus(active: number, expired: number, error: number): SiteOverallStatus {
  if (error > 0) return 'error';
  if (expired > 0) return 'expired';
  if (active > 0) return 'active';
  return 'unknown';
}

export function buildSiteCardView(
  site: SiteRecord,
  accounts: AccountRecord[],
  summary?: SiteSummary,
): SiteCardView {
  const siteAccounts = accounts.filter(account => account.siteId === site.id);
  const count = (state: AuthState): number => siteAccounts.filter(account => account.authState === state).length;
  const active = count('active');
  const expired = count('expired');
  const error = count('error');
  return {
    accountCount: siteAccounts.length,
    active,
    expired,
    error,
    unknown: count('unknown'),
    balanceTotal: summary?.balanceTotal ?? null,
    checkedInToday: summary?.checkedInToday ?? 0,
    overallStatus: deriveOverallStatus(active, expired, error),
  };
}

const PLATFORM_LABELS: Record<PlatformType, string> = {
  newapi: 'NewAPI',
  sub2api: 'Sub2API',
  cliproxyapi: 'CLIProxyAPI',
};

/** 平台文字徽章标签（无第三方 logo，符合项目风格）。 */
export function platformLabel(site: SiteRecord): string {
  return PLATFORM_LABELS[site.platform];
}

/** 站点整体状态的中文文案与配色类后缀（复用 auth-badge 配色）。 */
export function overallStatusLabel(status: SiteOverallStatus): string {
  if (status === 'active') return '有效';
  if (status === 'expired') return '过期';
  if (status === 'error') return '异常';
  return '未知';
}

export function routeProfileLabel(site: SiteRecord): string {
  if (site.platform !== 'newapi') return '平台默认路由';
  if (site.routeProfile === 'modern') return '新版 UI';
  if (site.routeProfile === 'classic') return '兼容旧版 UI';
  return '历史 Panel 路由';
}

/**
 * 余额合计展示文案；null 时为「暂无余额」，绝不显示伪造 0（红线）。
 * balanceTotal 已由主进程换算为 USD 合计，此处仅格式化为两位小数。
 */
export function balanceTotalLabel(balanceTotal: number | null): string {
  if (balanceTotal === null) return '暂无余额';
  return `余额合计 $${balanceTotal.toFixed(2)}`;
}
