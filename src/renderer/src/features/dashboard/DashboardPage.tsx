import { useEffect, useMemo, useState } from 'react';
import type { DashboardOverview, PlatformType, AuthState } from '../../../../shared/ipc/bridge';
import { getSafeErrorMessage } from '../../lib/error-message';
import {
  aggregateSnapshot,
  buildDashboardStats,
  DashboardFilters,
  filterDashboardAccounts,
} from './dashboard-view';

const INITIAL_OVERVIEW: DashboardOverview = { accounts: [] };
const INITIAL_FILTERS: DashboardFilters = { platform: 'all', query: '', authState: 'all' };

export function DashboardPage(): React.JSX.Element {
  const [overview, setOverview] = useState<DashboardOverview>(INITIAL_OVERVIEW);
  const [filters, setFilters] = useState<DashboardFilters>(INITIAL_FILTERS);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.apinest.dashboard.getOverview()
      .then(result => {
        if (!cancelled) {
          setOverview(result);
        }
      })
      .catch(error => {
        if (!cancelled) {
          setErrorMessage(getSafeErrorMessage(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => buildDashboardStats(overview), [overview]);
  const filteredAccounts = useMemo(
    () => filterDashboardAccounts(overview.accounts, filters),
    [filters, overview.accounts],
  );
  const balance = useMemo(() => aggregateSnapshot(filteredAccounts, 'balance'), [filteredAccounts]);
  const usage = useMemo(() => aggregateSnapshot(filteredAccounts, 'usage'), [filteredAccounts]);

  return (
    <section className="dashboard-page">
      <div className="dashboard-header">
        <div>
          <p className="eyebrow">总览</p>
          <h2>账户状态与最近操作</h2>
        </div>
      </div>
      {errorMessage ? <p className="error-message">{errorMessage}</p> : null}

      <dl className="meta-grid">
        <div><dt>账户总数</dt><dd>{stats.total}</dd></div>
        <div><dt>有效</dt><dd>{stats.active}</dd></div>
        <div><dt>已过期</dt><dd>{stats.expired}</dd></div>
        <div><dt>异常</dt><dd>{stats.error}</dd></div>
        <div><dt>可安全聚合余额</dt><dd>{balance ? `$${balance.value.toFixed(2)}` : '不可聚合'}</dd></div>
        <div><dt>可安全聚合用量</dt><dd>{usage ? `$${usage.value.toFixed(4)}` : '不可聚合'}</dd></div>
      </dl>

      <div className="dashboard-filters">
        <input
          type="search"
          value={filters.query}
          onChange={event => setFilters(current => ({ ...current, query: event.target.value }))}
          placeholder="按账户名称筛选"
        />
        <select
          value={filters.platform}
          onChange={event => setFilters(current => ({ ...current, platform: event.target.value as PlatformType | 'all' }))}
        >
          <option value="all">全部平台</option>
          <option value="newapi">NewAPI</option>
          <option value="sub2api">Sub2API</option>
          <option value="cliproxyapi">CLIProxyAPI</option>
        </select>
        <select
          value={filters.authState}
          onChange={event => setFilters(current => ({ ...current, authState: event.target.value as AuthState | 'all' }))}
        >
          <option value="all">全部状态</option>
          <option value="active">有效</option>
          <option value="expired">已过期</option>
          <option value="error">异常</option>
          <option value="unknown">未知</option>
        </select>
      </div>

      <div className="dashboard-list">
        {filteredAccounts.map(({ account, operations }) => {
          const latest = operations[0];
          return (
            <article key={account.id} className="dashboard-account">
              <div>
                <strong>{account.siteName} · {account.displayName}</strong>
                <p>{account.platform} · {account.authState}</p>
              </div>
              <p>
                {latest
                  ? `最近${latest.kind}：${latest.status === 'error' ? latest.errorSummary ?? '失败' : '成功'}`
                  : '暂无操作记录'}
              </p>
            </article>
          );
        })}
        {filteredAccounts.length === 0 ? <p className="empty-state">没有符合筛选条件的账户。</p> : null}
      </div>
    </section>
  );
}
