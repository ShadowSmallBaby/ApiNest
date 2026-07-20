import type { AccountRecord, ModelRecord, SiteRecord } from '../../../../shared/ipc/bridge';

/** 模型页筛选状态：站点与账号均支持「全部」，并可切换仅看可用。 */
export interface ModelFilters {
  siteId: string | 'all';
  accountId: string | 'all';
  availableOnly: boolean;
}

export const INITIAL_MODEL_FILTERS: ModelFilters = {
  siteId: 'all',
  accountId: 'all',
  availableOnly: false,
};

/**
 * 按当前站点筛选可选账号。站点为「全部」时返回全部账号，
 * 否则仅返回该站点下的账号。
 */
export function accountsForSite(
  accounts: AccountRecord[],
  siteId: string | 'all',
): AccountRecord[] {
  if (siteId === 'all') {
    return accounts;
  }
  return accounts.filter(account => account.siteId === siteId);
}

/**
 * 依据筛选求出目标账号集合（用于批量拉取模型）。
 * 账号为「全部」时取站点范围内所有账号，否则取单个账号。
 */
export function targetAccounts(
  accounts: AccountRecord[],
  filters: Pick<ModelFilters, 'siteId' | 'accountId'>,
): AccountRecord[] {
  const scoped = accountsForSite(accounts, filters.siteId);
  if (filters.accountId === 'all') {
    return scoped;
  }
  return scoped.filter(account => account.id === filters.accountId);
}

/**
 * 校正筛选：当所选账号不在当前站点范围内时，把账号重置为「全部」，
 * 避免站点切换后残留跨站点的账号选择。
 */
export function reconcileFilters(
  accounts: AccountRecord[],
  filters: ModelFilters,
): ModelFilters {
  if (filters.accountId === 'all') {
    return filters;
  }
  const scoped = accountsForSite(accounts, filters.siteId);
  if (!scoped.some(account => account.id === filters.accountId)) {
    return { ...filters, accountId: 'all' };
  }
  return filters;
}

/** 仅 NewAPI 站点支持模型管理；其余平台不纳入可选站点。 */
export function modelCapableSites(sites: SiteRecord[]): SiteRecord[] {
  return sites.filter(site => site.platform === 'newapi');
}

/** 仅看可用时过滤出账户实际可用的模型，否则原样返回。 */
export function applyAvailabilityFilter(
  models: ModelRecord[],
  availableOnly: boolean,
): ModelRecord[] {
  if (!availableOnly) {
    return models;
  }
  return models.filter(model => model.availableForAccount);
}

/** 计费类型 → 中文说明（1=按次计费，其余按量计费）。 */
export function describeQuotaType(quotaType: number): string {
  return quotaType === 1 ? '按次计费' : '按量计费';
}

/**
 * 计费展示：按次计费展示单价，按量计费展示输入/补全倍率。
 * 保守处理：数值缺失时不伪造，直接展示原值。
 */
export function describePricing(
  model: Pick<ModelRecord, 'quotaType' | 'modelPrice' | 'modelRatio' | 'completionRatio'>,
): string {
  if (model.quotaType === 1) {
    return `$${model.modelPrice} / 次`;
  }
  return `输入 ×${model.modelRatio} / 补全 ×${model.completionRatio}`;
}

/** 分组列表 → 展示文本（空数组时以「—」占位）。 */
export function describeGroups(groups: string[]): string {
  return groups.length > 0 ? groups.join('、') : '—';
}

/** 端点类型列表 → 展示文本（空数组时以「—」占位）。 */
export function describeEndpoints(endpoints: string[]): string {
  return endpoints.length > 0 ? endpoints.join('、') : '—';
}
