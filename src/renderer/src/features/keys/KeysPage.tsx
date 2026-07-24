import { useEffect, useMemo, useState } from 'react';
import type { AccountRecord, SiteRecord } from '../../../../shared/ipc/bridge';
import { getSafeErrorMessage } from '../../lib/error-message';
import { CopyIcon, EyeIcon, EyeOffIcon, RefreshIcon } from '../../components/icons';
import {
  INITIAL_KEY_FILTERS,
  accountsForSite,
  describeKeyStatus,
  describeQuota,
  flattenKeyRows,
  formatKeyTime,
  keyCapableSites,
  loadAccountsKeys,
  reconcileFilters,
  syncableAccounts,
  targetAccounts,
  type AccountKeysResult,
  type KeyFilters,
} from './keys-view';

/**
 * 密钥管理页。
 *
 * 数据本地优先：listByAccount 只读本地持久化的脱敏视图，不联网；
 * 「刷新」显式联网拉取远程列表覆盖本地元数据；「显示」按需揭示明文
 * （本地已入库则离线解密，未入库则联网获取并加密入库）。
 * 红线：列表 key 始终脱敏；完整明文只在用户点「显示」时经独立通道取回，
 * 仅在当前会话内存中短暂持有，不写任何持久层的明文缓存。
 * 多账号加载逐账户隔离：单账户失败只在其区块提示，不清空其它账户结果。
 */
export function KeysPage(): React.JSX.Element {
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [filters, setFilters] = useState<KeyFilters>(INITIAL_KEY_FILTERS);
  const [accountKeys, setAccountKeys] = useState<AccountKeysResult[]>([]);
  const [revealedKeys, setRevealedKeys] = useState<Record<string, string>>({});
  const [isBusy, setIsBusy] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
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

  // 筛选变化时读取本地数据（本地优先，不联网）。
  // 逐账户隔离：单账户失败不影响其它账户，绝不整批清空。
  useEffect(() => {
    let cancelled = false;
    const targets = targetAccounts(accounts, filters);
    if (targets.length === 0) {
      setAccountKeys([]);
      return;
    }
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

  // 刷新：仅对会话有效的账号联网拉取远程列表覆盖本地元数据，再重读本地。
  // 无效账号（已过期/异常）跳过，避免无谓联网；本地已存密钥仍照常展示。
  const handleRefresh = async (): Promise<void> => {
    const targets = syncableAccounts(targetAccounts(accounts, filters));
    if (targets.length === 0) {
      setMessage('当前没有可刷新的有效账号，请先在「站点」登录。');
      return;
    }
    setIsRefreshing(true);
    setErrorMessage(null);
    setMessage(null);
    try {
      await loadAccountsKeys(targets, accountId => window.apinest.keys.refresh(accountId));
      // 重读本地（含未刷新的有效账号旧数据），保持列表完整。
      const results = await loadAccountsKeys(
        targetAccounts(accounts, filters),
        accountId => window.apinest.keys.listByAccount(accountId),
      );
      setAccountKeys(results);
      setRevealedKeys({});
      setMessage('已刷新最新密钥列表。');
    } finally {
      setIsRefreshing(false);
    }
  };

  // 批量入库：仅对会话有效的账号，把尚未入库的明文逐个获取并加密入库（不回传明文本身）。
  // 无效账号跳过；完成后重读本地，使各行 hasPlaintext 标记刷新为「已入库」。
  const handleCaptureAll = async (): Promise<void> => {
    const targets = syncableAccounts(targetAccounts(accounts, filters));
    if (targets.length === 0) {
      setMessage('当前没有可入库的有效账号，请先在「站点」登录。');
      return;
    }
    setIsCapturing(true);
    setErrorMessage(null);
    setMessage(null);
    try {
      let captured = 0;
      let failed = 0;
      for (const target of targets) {
        try {
          const result = await window.apinest.keys.captureAll(target.id);
          captured += result.captured;
          failed += result.failed;
        } catch {
          // 单账户失败不中断整批；计入失败数，其它账户照常处理。
          failed += 1;
        }
      }
      // 重读本地刷新 hasPlaintext 标记（含未入库的有效账号旧数据）。
      const results = await loadAccountsKeys(
        targetAccounts(accounts, filters),
        accountId => window.apinest.keys.listByAccount(accountId),
      );
      setAccountKeys(results);
      setMessage(`已入库 ${captured} 个明文${failed > 0 ? `，${failed} 个失败` : ''}。`);
    } finally {
      setIsCapturing(false);
    }
  };

  // 显示/隐藏切换：显示时经 reveal 通道取明文（本地已入库则离线解密），
  // 隐藏时仅从内存移除，绝不缓存明文。
  const handleToggleReveal = async (accountId: string, tokenId: number): Promise<void> => {
    const mapKey = `${accountId}:${tokenId}`;
    if (revealedKeys[mapKey] !== undefined) {
      setRevealedKeys(current => {
        const next = { ...current };
        delete next[mapKey];
        return next;
      });
      return;
    }
    try {
      const fullKey = await window.apinest.keys.reveal(accountId, tokenId);
      setRevealedKeys(current => ({ ...current, [mapKey]: fullKey }));
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
  const canOperate = targetAccounts(accounts, filters).length > 0;
  const keyRows = useMemo(() => flattenKeyRows(accountKeys), [accountKeys]);

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
          <div className="keys-toolbar">
            <div className="dashboard-filters">
              <select value={filters.siteId} disabled={isBusy || isRefreshing} onChange={event => handleSiteChange(event.target.value)}>
                <option value="all">全部站点</option>
                {sites.map(site => (
                  <option key={site.id} value={site.id}>{site.name}</option>
                ))}
              </select>
              <select
                value={filters.accountId}
                disabled={isBusy || isRefreshing || filters.siteId === 'all'}
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
            <div className="keys-toolbar-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={!canOperate || isBusy || isRefreshing}
                onClick={() => void handleRefresh()}
              >
                <RefreshIcon />
                {isRefreshing ? '刷新中…' : '刷新'}
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={!canOperate || isBusy || isRefreshing || isCapturing}
                onClick={() => void handleCaptureAll()}
              >
                {isCapturing ? '入库中…' : '批量入库明文'}
              </button>
              {/* 创建密钥为高风险写操作，一期占位，暂不实现。 */}
              <button type="button" className="primary-button" disabled title="即将推出">
                创建密钥
              </button>
            </div>
          </div>

          {errorMessage ? <p className="error-message">{errorMessage}</p> : null}
          {message ? <p className="hint">{message}</p> : null}
          {isBusy ? <p className="hint">加载中…</p> : null}

          {!isBusy && keyRows.length === 0 ? (
            <p className="empty-state">
              {canOperate ? '本地暂无密钥，点「刷新」从站点拉取。' : '请选择要查看的站点或账号。'}
            </p>
          ) : keyRows.length > 0 ? (
            <table className="keys-table">
              <thead>
                <tr>
                  <th>#</th><th>名称</th><th>密钥</th><th>分组</th>
                  <th>额度</th><th>状态</th><th>创建时间</th><th>站点 · 账号</th><th>操作</th>
                </tr>
              </thead>
              <tbody>
                {keyRows.map((row, index) => {
                  const mapKey = `${row.account.id}:${row.key.id}`;
                  const revealed = revealedKeys[mapKey];
                  const displayKey = revealed ?? row.key.maskedKey;
                  const isRevealed = revealed !== undefined;
                  return (
                    <tr key={mapKey}>
                      <td>{index + 1}</td>
                      <td>{row.key.name || '（未命名）'}</td>
                      <td className="keys-key-cell">
                        <span className="keys-key-value">{displayKey}</span>
                        <button
                          type="button"
                          className="icon-button"
                          title="复制"
                          onClick={() => void handleCopy(displayKey)}
                        >
                          <CopyIcon />
                        </button>
                        {row.key.hasPlaintext ? (
                          <span className="keys-plaintext-badge" title="明文已入库，可离线显示">已入库</span>
                        ) : null}
                      </td>
                      <td>{row.key.group ?? '—'}</td>
                      <td>{describeQuota(row.key)}</td>
                      <td>{describeKeyStatus(row.key.status)}</td>
                      <td>{formatKeyTime(row.key.createdTime)}</td>
                      <td>{row.siteAccountLabel}</td>
                      <td>
                        <div className="keys-row-actions">
                          <button
                            type="button"
                            className="icon-button"
                            title={isRevealed ? '隐藏' : '显示'}
                            onClick={() => void handleToggleReveal(row.account.id, row.key.id)}
                          >
                            {isRevealed ? <EyeOffIcon /> : <EyeIcon />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}
        </>
      )}
    </section>
  );
}
