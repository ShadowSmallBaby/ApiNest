import { useEffect, useMemo, useState } from 'react';
import type { AccountRecord, ModelRecord, SiteRecord } from '../../../../shared/ipc/bridge';
import { getSafeErrorMessage } from '../../lib/error-message';
import {
  INITIAL_MODEL_FILTERS,
  accountsForSite,
  applyAvailabilityFilter,
  describeEndpoints,
  describeGroups,
  describePricing,
  describeQuotaType,
  modelCapableSites,
  reconcileFilters,
  targetAccounts,
  type ModelFilters,
} from './models-view';

/** 单账号模型拉取结果（用于聚合展示与错误定位）。 */
interface AccountModels {
  account: AccountRecord;
  models: ModelRecord[];
}

/**
 * 模型管理页。
 *
 * 站点 → 账号级联筛选，拉取目标账号的 NewAPI 模型定价与可用性。
 * 可用性由 /api/pricing 与 /api/user/models 取交集得出；
 * 保守红线：交集不确定时标注为不可用，绝不伪造可用。
 */
export function ModelsPage(): React.JSX.Element {
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [filters, setFilters] = useState<ModelFilters>(INITIAL_MODEL_FILTERS);
  const [accountModels, setAccountModels] = useState<AccountModels[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 站点/账号列表加载一次。仅 NewAPI 站点支持模型管理。
  useEffect(() => {
    let cancelled = false;
    Promise.all([window.apinest.sites.list(), window.apinest.accounts.list()])
      .then(([nextSites, nextAccounts]) => {
        if (cancelled) return;
        setSites(modelCapableSites(nextSites));
        setAccounts(nextAccounts);
      })
      .catch(error => {
        if (!cancelled) setErrorMessage(getSafeErrorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleAccounts = useMemo(
    () => accountsForSite(accounts, filters.siteId),
    [accounts, filters.siteId],
  );

  const selectableAccounts = useMemo(
    () => (filters.siteId === 'all' ? [] : visibleAccounts),
    [filters.siteId, visibleAccounts],
  );

  // 拉取当前筛选目标账号的模型。每次站点/账号变化重新拉取。
  useEffect(() => {
    const targets = targetAccounts(accounts, filters);
    if (targets.length === 0) {
      setAccountModels([]);
      return;
    }

    let cancelled = false;
    setIsBusy(true);
    setErrorMessage(null);

    Promise.all(
      targets.map(async account => ({
        account,
        models: await window.apinest.models.listByAccount(account.id),
      })),
    )
      .then(results => {
        if (!cancelled) setAccountModels(results);
      })
      .catch(error => {
        if (!cancelled) {
          setErrorMessage(getSafeErrorMessage(error));
          setAccountModels([]);
        }
      })
      .finally(() => {
        if (!cancelled) setIsBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [accounts, filters.siteId, filters.accountId]);

  const handleSiteChange = (siteId: string): void => {
    setFilters(current => reconcileFilters(accounts, { ...current, siteId: siteId as ModelFilters['siteId'] }));
  };

  const handleAccountChange = (accountId: string): void => {
    setFilters(current => ({ ...current, accountId: accountId as ModelFilters['accountId'] }));
  };

  const handleAvailableOnlyChange = (availableOnly: boolean): void => {
    setFilters(current => ({ ...current, availableOnly }));
  };

  const hasNoSites = sites.length === 0;

  return (
    <section className="content-page models-page">
      <div className="content-header">
        <p className="eyebrow">模型管理</p>
        <h2>可用模型</h2>
      </div>

      {hasNoSites ? (
        <p className="empty-state">暂无 NewAPI 站点，请先在「站点」中创建。</p>
      ) : (
        <>
          <div className="dashboard-filters">
            <select value={filters.siteId} disabled={isBusy} onChange={event => handleSiteChange(event.target.value)}>
              <option value="all">全部站点</option>
              {sites.map(site => (
                <option key={site.id} value={site.id}>{site.name}</option>
              ))}
            </select>
            <select
              value={filters.accountId}
              disabled={isBusy || filters.siteId === 'all'}
              onChange={event => handleAccountChange(event.target.value)}
            >
              <option value="all">
                {filters.siteId === 'all' ? '先选择站点' : '全部账号'}
              </option>
              {selectableAccounts.map(account => (
                <option key={account.id} value={account.id}>{account.displayName}</option>
              ))}
            </select>
            <label className="models-available-toggle">
              <input
                type="checkbox"
                checked={filters.availableOnly}
                disabled={isBusy}
                onChange={event => handleAvailableOnlyChange(event.target.checked)}
              />
              仅看可用
            </label>
          </div>

          {errorMessage ? <p className="error-message">{errorMessage}</p> : null}
          {isBusy ? <p className="hint">加载中…</p> : null}

          {accountModels.map(({ account, models }) => {
            const shown = applyAvailabilityFilter(models, filters.availableOnly);
            return (
              <div key={account.id} className="models-account-block">
                <h3>{account.siteName} · {account.displayName}</h3>
                {shown.length === 0 ? (
                  <p className="empty-state">
                    {filters.availableOnly ? '该账号暂无可用模型。' : '该账号暂无模型。'}
                  </p>
                ) : (
                  <table className="models-table">
                    <thead>
                      <tr>
                        <th>模型</th><th>计费</th><th>价格/倍率</th><th>分组</th><th>端点</th><th>可用</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map(model => (
                        <tr key={model.modelName} className={model.availableForAccount ? '' : 'models-row-unavailable'}>
                          <td>{model.modelName}</td>
                          <td>{describeQuotaType(model.quotaType)}</td>
                          <td>{describePricing(model)}</td>
                          <td>{describeGroups(model.enableGroups)}</td>
                          <td>{describeEndpoints(model.supportedEndpointTypes)}</td>
                          <td>{model.availableForAccount ? '可用' : '不可用'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}
