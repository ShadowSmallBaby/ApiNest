import { useEffect, useMemo, useState } from 'react';
import type {
  AccountRecord,
  ApiKeyRecord,
  SiteRecord,
  UsageLogPage,
  UsageLogQuery,
  UsageLogType,
} from '../../../../shared/ipc/bridge';
import { getSafeErrorMessage } from '../../lib/error-message';
import {
  INITIAL_LOG_FILTERS,
  accountsForSite,
  dateToTimestamp,
  describeDuration,
  describeKeyOption,
  describeLogType,
  describeTokenUsage,
  formatLogTime,
  logCapableSites,
  reconcileFilters,
  type LogFilters,
} from './logs-view';

const PAGE_SIZE = 50;
const LOG_TYPES: UsageLogType[] = [0, 1, 2, 3, 4, 5, 6];

/**
 * NewAPI 在线日志页。
 *
 * 只允许查询明确选中的单个账户，避免跨账户分页语义和会话边界混淆；
 * Key 筛选只发送 token_name，完整 Key 不进入查询、页面状态或日志。
 */
export function LogsPage(): React.JSX.Element {
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [filters, setFilters] = useState<LogFilters>(INITIAL_LOG_FILTERS);
  const [pageNumber, setPageNumber] = useState(1);
  const [result, setResult] = useState<UsageLogPage | null>(null);
  const [isLoadingKeys, setIsLoadingKeys] = useState(false);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  // Key 列表错误与日志查询错误解耦：Key 加载失败仅降级 Key 筛选，不阻断日志查询。
  const [keysErrorMessage, setKeysErrorMessage] = useState<string | null>(null);
  const [logsErrorMessage, setLogsErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([window.apinest.sites.list(), window.apinest.accounts.list()])
      .then(([nextSites, nextAccounts]) => {
        if (cancelled) return;
        setSites(logCapableSites(nextSites));
        setAccounts(nextAccounts.filter(account => account.platform === 'newapi'));
      })
      .catch(error => {
        if (!cancelled) setLogsErrorMessage(getSafeErrorMessage(error));
      });
    return () => { cancelled = true; };
  }, []);

  const visibleAccounts = useMemo(
    () => accountsForSite(accounts, filters.siteId),
    [accounts, filters.siteId],
  );

  // 账户变化时只加载脱敏 Key 列表，不调用 reveal；旧 Key 筛选和旧日志立即清空。
  useEffect(() => {
    setKeys([]);
    setResult(null);
    setPageNumber(1);
    setKeysErrorMessage(null);
    setLogsErrorMessage(null);
    setFilters(current => current.tokenName ? { ...current, tokenName: '' } : current);
    if (!filters.accountId) return;

    let cancelled = false;
    setIsLoadingKeys(true);
    window.apinest.keys.listByAccount(filters.accountId)
      .then(nextKeys => { if (!cancelled) setKeys(nextKeys); })
      .catch(error => { if (!cancelled) setKeysErrorMessage(getSafeErrorMessage(error)); })
      .finally(() => { if (!cancelled) setIsLoadingKeys(false); });
    return () => { cancelled = true; };
  }, [filters.accountId]);

  const fetchLogs = async (nextPage = 1): Promise<void> => {
    if (!filters.accountId) return;
    const query: UsageLogQuery = {
      page: nextPage,
      pageSize: PAGE_SIZE,
      ...(filters.type === 'all' ? {} : { type: filters.type }),
      ...(filters.tokenName ? { tokenName: filters.tokenName } : {}),
      ...(filters.modelName.trim() ? { modelName: filters.modelName.trim() } : {}),
      ...(filters.startDate ? { startTimestamp: dateToTimestamp(filters.startDate, false) } : {}),
      ...(filters.endDate ? { endTimestamp: dateToTimestamp(filters.endDate, true) } : {}),
    };
    try {
      setIsLoadingLogs(true);
      setLogsErrorMessage(null);
      const nextResult = await window.apinest.logs.listByAccount(filters.accountId, query);
      setPageNumber(nextPage);
      setResult(nextResult);
    } catch (error) {
      // 保留上一成功页，仅提示本次查询失败，不清空已有结果。
      setLogsErrorMessage(getSafeErrorMessage(error));
    } finally {
      setIsLoadingLogs(false);
    }
  };

  const updateFilter = <K extends keyof LogFilters>(key: K, value: LogFilters[K]): void => {
    setFilters(current => ({ ...current, [key]: value }));
    setPageNumber(1);
    setResult(null);
  };

  const handleSiteChange = (siteId: string): void => {
    setFilters(current => reconcileFilters(accounts, { ...current, siteId: siteId as LogFilters['siteId'] }));
    setPageNumber(1);
    setResult(null);
  };

  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  const isBusy = isLoadingKeys || isLoadingLogs;

  return (
    <section className="content-page logs-page">
      <div className="content-header">
        <p className="eyebrow">日志管理</p>
        <h2>NewAPI 用量日志</h2>
      </div>

      {sites.length === 0 ? (
        <p className="empty-state">暂无 NewAPI 站点，请先在「站点」中创建。</p>
      ) : (
        <>
          <div className="logs-filters">
            <select value={filters.siteId} disabled={isBusy} onChange={event => handleSiteChange(event.target.value)}>
              <option value="all">全部站点</option>
              {sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
            </select>
            <select
              value={filters.accountId}
              disabled={isBusy}
              onChange={event => updateFilter('accountId', event.target.value)}
            >
              <option value="">选择账号后查询</option>
              {visibleAccounts.map(account => (
                <option key={account.id} value={account.id}>{account.displayName}</option>
              ))}
            </select>
            <select
              value={filters.tokenName}
              disabled={!filters.accountId || isBusy}
              onChange={event => updateFilter('tokenName', event.target.value)}
            >
              <option value="">全部 Key</option>
              {keys.filter(key => key.name.trim()).map(key => (
                <option key={key.id} value={key.name}>{describeKeyOption(key)}</option>
              ))}
            </select>
            <select
              value={filters.type}
              disabled={isBusy}
              onChange={event => updateFilter('type', event.target.value === 'all' ? 'all' : Number(event.target.value) as UsageLogType)}
            >
              <option value="all">全部类型</option>
              {LOG_TYPES.filter(type => type !== 0).map(type => (
                <option key={type} value={type}>{describeLogType(type)}</option>
              ))}
            </select>
            <input
              type="text"
              value={filters.modelName}
              disabled={isBusy}
              placeholder="模型名称"
              maxLength={256}
              onChange={event => updateFilter('modelName', event.target.value)}
            />
            <input type="date" value={filters.startDate} disabled={isBusy} onChange={event => updateFilter('startDate', event.target.value)} />
            <input type="date" value={filters.endDate} disabled={isBusy} onChange={event => updateFilter('endDate', event.target.value)} />
            <button type="button" className="primary-button" disabled={!filters.accountId || isBusy} onClick={() => void fetchLogs(1)}>
              {isLoadingLogs ? '查询中…' : '查询'}
            </button>
          </div>

          <p className="hint">日志在线读取，不保存原始响应；Key 仅按名称筛选，完整密钥不会被揭示。</p>
          {keysErrorMessage ? (
            <p className="hint">Key 名称筛选暂不可用（{keysErrorMessage}），可选「全部 Key」或按其它条件查询。</p>
          ) : null}
          {logsErrorMessage ? <p className="error-message">{logsErrorMessage}</p> : null}

          {result ? (
            <>
              <div className="logs-summary">共 {result.total} 条 · 第 {pageNumber}/{totalPages} 页</div>
              {result.items.length === 0 ? (
                <p className="empty-state">当前条件下暂无日志。</p>
              ) : (
                <div className="logs-table-wrap">
                  <table className="logs-table">
                    <thead>
                      <tr><th>时间</th><th>类型</th><th>Key</th><th>模型</th><th>输入/输出</th><th>额度</th><th>耗时</th><th>方式</th></tr>
                    </thead>
                    <tbody>
                      {result.items.map((log, index) => (
                        <tr key={`${log.createdAt}:${log.tokenId ?? 'none'}:${index}`}>
                          <td>{formatLogTime(log.createdAt)}</td>
                          <td>{describeLogType(log.type)}</td>
                          <td>{log.tokenName ?? (log.tokenId === undefined ? '—' : `#${log.tokenId}`)}</td>
                          <td>{log.modelName ?? '—'}</td>
                          <td>{describeTokenUsage(log.promptTokens, log.completionTokens)}</td>
                          <td>{log.quota ?? '—'}</td>
                          <td>{describeDuration(log.useTime)}</td>
                          <td>{log.isStream === undefined ? '—' : log.isStream ? '流式' : '非流式'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="logs-pagination">
                <button type="button" className="secondary-button" disabled={isBusy || pageNumber <= 1} onClick={() => void fetchLogs(pageNumber - 1)}>上一页</button>
                <button type="button" className="secondary-button" disabled={isBusy || pageNumber >= totalPages} onClick={() => void fetchLogs(pageNumber + 1)}>下一页</button>
              </div>
            </>
          ) : (
            <p className="empty-state">请选择明确账号并点击“查询”。</p>
          )}
        </>
      )}
    </section>
  );
}
