import type { AccountRecord, ApiKeyRecord, SiteRecord, UsageLogType } from '../../../../shared/ipc/bridge';

export interface LogFilters {
  siteId: string | 'all';
  accountId: string;
  tokenName: string;
  modelName: string;
  type: UsageLogType | 'all';
  startDate: string;
  endDate: string;
}

export const INITIAL_LOG_FILTERS: LogFilters = {
  siteId: 'all',
  accountId: '',
  tokenName: '',
  modelName: '',
  type: 2,
  startDate: '',
  endDate: '',
};

export function accountsForSite(accounts: AccountRecord[], siteId: string | 'all'): AccountRecord[] {
  if (siteId === 'all') return accounts;
  return accounts.filter(account => account.siteId === siteId);
}

/** 切换站点时清空不属于新站点的账户和 Key，避免跨账户筛选串用。 */
export function reconcileFilters(accounts: AccountRecord[], filters: LogFilters): LogFilters {
  if (!filters.accountId) return filters;
  if (accountsForSite(accounts, filters.siteId).some(account => account.id === filters.accountId)) {
    return filters;
  }
  return { ...filters, accountId: '', tokenName: '' };
}

/** 仅 NewAPI 站点支持 /api/log/self。 */
export function logCapableSites(sites: SiteRecord[]): SiteRecord[] {
  return sites.filter(site => site.platform === 'newapi');
}

/** Key 下拉只使用名称和脱敏值，绝不读取或展示完整 key。 */
export function describeKeyOption(key: ApiKeyRecord): string {
  const name = key.name.trim() || `#${key.id}`;
  return `${name} · ${key.maskedKey}`;
}

export function describeLogType(type: UsageLogType): string {
  const descriptions: Record<UsageLogType, string> = {
    0: '全部',
    1: '充值',
    2: '消费',
    3: '管理',
    4: '系统',
    5: '错误',
    6: '退款',
  };
  return descriptions[type];
}

/** HTML date（本地自然日）转 Unix 秒；结束日期包含当天 23:59:59。 */
export function dateToTimestamp(value: string, endOfDay: boolean): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const suffix = endOfDay ? 'T23:59:59' : 'T00:00:00';
  const milliseconds = new Date(`${value}${suffix}`).getTime();
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined;
}

export function formatLogTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}

export function describeTokenUsage(prompt?: number, completion?: number): string {
  if (prompt === undefined && completion === undefined) return '—';
  return `${prompt ?? '—'} / ${completion ?? '—'}`;
}

export function describeDuration(seconds?: number): string {
  return seconds === undefined ? '—' : `${seconds}s`;
}
