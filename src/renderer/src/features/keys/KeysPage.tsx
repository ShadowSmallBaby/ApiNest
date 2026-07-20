import { useEffect, useMemo, useState } from 'react';
import type { AccountRecord, SiteRecord } from '../../../../shared/ipc/bridge';
import { getSafeErrorMessage, isReloginError } from '../../lib/error-message';
import {
  INITIAL_KEY_FILTERS,
  accountsForSite,
  describeKeyStatus,
  describeQuota,
  keyCapableSites,
  loadAccountsKeys,
  reconcileFilters,
  targetAccounts,
  type AccountKeysResult,
  type KeyFilters,
} from './keys-view';

/**
 * 密钥管理页。
 *
 * 站点 → 账号级联筛选，拉取目标账号的 NewAPI 密钥。
 * 红线：列表 key 始终脱敏；完整明文只在用户点「揭示」时经独立通道取回，
 * 仅在当前会话内存中短暂持有，不写任何持久层。
 * 多账号加载逐账户隔离：单账户失败只在其区块提示，不清空其它账户结果。
 */
export function KeysPage(): React.JSX.Element {
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [filters, setFilters] = useState<KeyFilters>(INITIAL_KEY_FILTERS);
  const [accountKeys, setAccountKeys] = useState<AccountKeysResult[]>([]);
  const [revealedKeys, setRevealedKeys] = useState<Record<string, string>>({});
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // 站点/账号列表加载一次。仅 NewAPI 站点支持密钥管理。
  useEffect(() => {
    let cancelled = false;
    Promise.all([window.apinest.sites.list(), window.apinest.accounts.list()])
      .then(([nextSites, nextAccounts]) => {
        if (cancelled) return;
        setSites(keyCapableSites(nextSites));
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

  // 拉取当前筛选目标账号的密钥。每次筛选变化重新拉取并清空旧揭示态。
  // 逐账户隔离：单账户失败不影响其它账户，绝不整批清空。
  useEffect(() => {
    const targets = targetAccounts(accounts, filters);
    if (targets.length === 0) {
      setAccountKeys([]);
      return;
    }

    let cancelled = false;
    setIsBusy(true);
    setErrorMessage(null);
    setMessage(null);
    setRevealedKeys({});

    loadAccountsKeys(targets, accountId => window.apinest.keys.listByAccount(accountId))
      .then(results => {
        if (!cancelled) setAccountKeys(results);
      })
      .finally(() => {
        if (!cancelled) setIsBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [accounts, filters]);

  const handleSiteChange = (siteId: string): void => {
    setFilters(current => reconcileFilters(accounts, { ...current, siteId: siteId as KeyFilters['siteId'] }));
  };

  const handleAccountChange = (accountId: string): void => {
    setFilters(current => ({ ...current, accountId: accountId as KeyFilters['accountId'] }));
  };

  const handleReveal = async (accountId: string, tokenId: number): Promise<void> => {
    const mapKey = `${accountId}:${tokenId}`;
    try {
      const fullKey = await window.apinest.keys.reveal(accountId, tokenId);
      setRevealedKeys(current => ({ ...current, [mapKey]: fullKey }));
    } catch (error) {
      setErrorMessage(getSafeErrorMessage(error));
    }
  };

  const handleOpenLogin = async (accountId: string): Promise<void> => {
    try {
      await window.apinest.auth.openLogin(accountId, 'manual');
      setMessage('登录窗口已打开，完成登录后请重新查询。');
    } catch (error) {
      setErrorMessage(getSafeErrorMessage(error));
    }
  };

  const handleCopy = async (value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage('已复制到剪贴板。');
    } catch {
      setErrorMessage('复制失败，请手动选择复制。');
    }
  };

  const hasNoSites = sites.length === 0;

  return (
    <section className="content-page keys-page">
      <div className="content-header">
        <p className="eyebrow">密钥管理</p>
        <h2>API 密钥</h2>
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
          </div>

          {errorMessage ? <p className="error-message">{errorMessage}</p> : null}
          {message ? <p className="hint">{message}</p> : null}
          {isBusy ? <p className="hint">加载中…</p> : null}

          {accountKeys.map(result => (
            <div key={result.account.id} className="keys-account-block">
              <h3>{result.account.siteName} · {result.account.displayName}</h3>
              {result.status === 'error' ? (
                <div className="keys-account-error">
                  <p className="error-message">{getSafeErrorMessage(result.error)}</p>
                  {isReloginError(result.error) ? (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void handleOpenLogin(result.account.id)}
                    >
                      打开登录
                    </button>
                  ) : null}
                </div>
              ) : result.keys.length === 0 ? (
                <p className="empty-state">该账号暂无密钥。</p>
              ) : (
                <table className="keys-table">
                  <thead>
                    <tr>
                      <th>名称</th><th>分组</th><th>额度</th><th>状态</th><th>密钥</th><th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.keys.map(key => {
                      const mapKey = `${result.account.id}:${key.id}`;
                      const revealed = revealedKeys[mapKey];
                      return (
                        <tr key={key.id}>
                          <td>{key.name || '（未命名）'}</td>
                          <td>{key.group ?? '—'}</td>
                          <td>{describeQuota(key)}</td>
                          <td>{describeKeyStatus(key.status)}</td>
                          <td className="keys-key-cell">{revealed ?? key.maskedKey}</td>
                          <td>
                            <div className="keys-row-actions">
                              <button
                                type="button"
                                className="secondary-button"
                                disabled={Boolean(revealed)}
                                onClick={() => void handleReveal(result.account.id, key.id)}
                              >
                                {revealed ? '已揭示' : '揭示'}
                              </button>
                              <button
                                type="button"
                                className="secondary-button"
                                onClick={() => void handleCopy(revealed ?? key.maskedKey)}
                              >
                                复制
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </>
      )}
    </section>
  );
}
