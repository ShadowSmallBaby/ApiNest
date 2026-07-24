import type {
  AuthState,
  DashboardAccount,
  DashboardOverview,
  PlatformType,
} from '../../../../shared/ipc/bridge';

/** NewAPI 标准默认汇率除数（quota → USD），与 account-snapshot-view 保持一致。 */
const DEFAULT_QUOTA_PER_UNIT = 500000;

export interface DashboardFilters {
  platform: PlatformType | 'all';
  query: string;
  authState: AuthState | 'all';
}

export interface DashboardStats {
  total: number;
  active: number;
  expired: number;
  error: number;
}

export interface DashboardAggregate {
  value: number;
  unit: string;
}

function parseFiniteNumber(payloadJson: string, field: 'remaining' | 'used'): number | null {
  try {
    const value = JSON.parse(payloadJson) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const candidate = (value as Record<string, unknown>)[field];
    return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function parseQuotaPerUnit(payloadJson: string): number {
  try {
    const value = JSON.parse(payloadJson) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return DEFAULT_QUOTA_PER_UNIT;
    }
    const candidate = (value as Record<string, unknown>).quotaPerUnit;
    return typeof candidate === 'number' && candidate > 0 ? candidate : DEFAULT_QUOTA_PER_UNIT;
  } catch {
    return DEFAULT_QUOTA_PER_UNIT;
  }
}

export function filterDashboardAccounts(
  accounts: DashboardAccount[],
  filters: DashboardFilters,
): DashboardAccount[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return accounts.filter(({ account }) =>
    (filters.platform === 'all' || account.platform === filters.platform)
    && (filters.authState === 'all' || account.authState === filters.authState)
    && (query.length === 0 || account.displayName.toLocaleLowerCase().includes(query)),
  );
}

export function buildDashboardStats(overview: DashboardOverview): DashboardStats {
  const states = overview.accounts.map(({ account }) => account.authState);
  return {
    total: states.length,
    active: states.filter(state => state === 'active').length,
    expired: states.filter(state => state === 'expired').length,
    error: states.filter(state => state === 'error').length,
  };
}

/**
 * 仅当每个账户都有有限值时聚合并换算为 USD；缺项或无效值返回 null。
 * 余额保留两位小数，用量保留四位小数。
 */
export function aggregateSnapshot(
  accounts: DashboardAccount[],
  kind: 'balance' | 'usage',
): DashboardAggregate | null {
  if (accounts.length === 0) {
    return null;
  }

  const field = kind === 'balance' ? 'remaining' : 'used';
  const values = accounts.map(({ snapshots }) => {
    const snapshot = snapshots.find(item => item.kind === kind);
    if (!snapshot) {
      return null;
    }
    const quotaValue = parseFiniteNumber(snapshot.payloadJson, field);
    if (quotaValue === null) {
      return null;
    }
    const quotaPerUnit = parseQuotaPerUnit(snapshot.payloadJson);
    return quotaValue / quotaPerUnit; // 换算为 USD
  });

  if (values.some(value => value === null)) {
    return null;
  }

  const validValues = values as number[];
  return {
    value: validValues.reduce((total, usd) => total + usd, 0),
    unit: 'USD',
  };
}
