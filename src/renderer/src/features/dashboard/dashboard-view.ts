import type {
  AuthState,
  DashboardAccount,
  DashboardOverview,
  PlatformType,
} from '../../../../shared/ipc/bridge';

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
 * 仅当每个账户都有同一明确单位的有限值时聚合；缺项、单位不同或无效值均返回 null。
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
    if (!snapshot?.semanticUnit) {
      return null;
    }
    const value = parseFiniteNumber(snapshot.payloadJson, field);
    return value === null ? null : { unit: snapshot.semanticUnit, value };
  });

  if (values.some(value => value === null)) {
    return null;
  }

  const validValues = values as Array<{ unit: string; value: number }>;
  const unit = validValues[0].unit;
  if (!validValues.every(value => value.unit === unit)) {
    return null;
  }

  return {
    value: validValues.reduce((total, item) => total + item.value, 0),
    unit,
  };
}
