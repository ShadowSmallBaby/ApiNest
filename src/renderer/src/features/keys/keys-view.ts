import type { AccountRecord, ApiKeyRecord, SiteRecord } from '../../../../shared/ipc/bridge';

/** 密钥页筛选状态：站点与账号均支持「全部」。 */
export interface KeyFilters {
  siteId: string | 'all';
  accountId: string | 'all';
}

export const INITIAL_KEY_FILTERS: KeyFilters = { siteId: 'all', accountId: 'all' };

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
 * 依据筛选求出目标账号集合（用于批量拉取密钥）。
 * 账号为「全部」时取站点范围内所有账号，否则取单个账号。
 */
export function targetAccounts(
  accounts: AccountRecord[],
  filters: KeyFilters,
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
  filters: KeyFilters,
): KeyFilters {
  if (filters.accountId === 'all') {
    return filters;
  }
  const scoped = accountsForSite(accounts, filters.siteId);
  if (!scoped.some(account => account.id === filters.accountId)) {
    return { ...filters, accountId: 'all' };
  }
  return filters;
}

/** 仅 NewAPI 站点支持密钥管理；其余平台不纳入可选站点。 */
export function keyCapableSites(sites: SiteRecord[]): SiteRecord[] {
  return sites.filter(site => site.platform === 'newapi');
}

/** 密钥状态码 → 中文说明（1=启用，其余保守标注为停用）。 */
export function describeKeyStatus(status: number): string {
  return status === 1 ? '启用' : '停用';
}

/** 额度展示：无限额度优先，否则展示 quota 原值。 */
export function describeQuota(record: Pick<ApiKeyRecord, 'unlimitedQuota' | 'remainQuota'>): string {
  return record.unlimitedQuota ? '无限' : String(record.remainQuota);
}

/** 单账号密钥拉取结果（账户级隔离：一个账户失败不影响其它账户展示）。 */
export type AccountKeysResult =
  | { account: AccountRecord; status: 'loaded'; keys: ApiKeyRecord[] }
  | { account: AccountRecord; status: 'error'; keys: []; error: unknown };

/**
 * 并发拉取多个账户的密钥，逐账户隔离成功/失败（部分成功）。
 * 任一账户失败只记录该账户 error，绝不使整批 reject 或清空其它账户结果。
 */
export async function loadAccountsKeys(
  accounts: AccountRecord[],
  loadOne: (accountId: string) => Promise<ApiKeyRecord[]>,
): Promise<AccountKeysResult[]> {
  return Promise.all(
    accounts.map(async (account): Promise<AccountKeysResult> => {
      try {
        return { account, status: 'loaded', keys: await loadOne(account.id) };
      } catch (error) {
        return { account, status: 'error', keys: [], error };
      }
    }),
  );
}
