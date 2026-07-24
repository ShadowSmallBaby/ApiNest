import { useEffect, useRef, useState } from 'react';
import type {
  AccountPageCapabilities,
  AccountRecord,
  AccountSnapshot,
  AuthIdentity,
  CheckInResult,
  KnownPage,
  SiteRecord,
  SiteSummary,
} from '../../../../shared/ipc/bridge';
import { getSafeErrorMessage } from '../../lib/error-message';
import type { EmbeddedRequest } from '../../shell/AppShell';
import { ConfirmSlideOver, SlideOver, type SlideOverWidth } from '../../components/SlideOver';
import { AccountDetail } from '../accounts/AccountDetail';
import { AccountForm } from '../accounts/AccountForm';
import {
  EMPTY_ACCOUNT_FORM,
  accountToFormValues,
  toCreateSiteAccountInput,
  toUpdateAccountInput,
  type AccountFormValues,
} from '../accounts/account-form';
import { SiteDetail } from './SiteDetail';
import { SiteForm } from './SiteForm';
import { SiteGrid } from './SiteGrid';
import {
  EMPTY_SITE_FORM,
  siteToFormValues,
  toCreateSiteInput,
  toUpdateSiteInput,
  type SiteFormValues,
} from './site-form';
import {
  DEFAULT_SITE_FILTER,
  collectSiteTags,
  filterSites,
  type SiteFilter,
} from './sites-filter';

const PAGE_TITLES: Record<KnownPage, string> = {
  home: '首页', userCenter: '用户中心', usage: '用量页', token: 'Token 页', login: '登录页',
};

/** 右侧 slide-over 承载的表单类型；确认交互另由 ConfirmSpec 承载。 */
type Panel =
  | { kind: 'create-site' }
  | { kind: 'edit-site' }
  | { kind: 'create-account' }
  | { kind: 'edit-account' };

/** 一次侧边栏确认的声明式描述（替代原生 window.confirm）。 */
interface ConfirmSpec {
  title: string;
  message: React.ReactNode;
  detail?: React.ReactNode;
  danger?: boolean;
  confirmLabel?: string;
  onConfirm: () => void;
}

/**
 * 站点管理页。主区在「站点广场（grid）」与「站点详情（detail）」两态间切换，
 * 一切次级交互——新增/编辑站点·账号、删除/同步/签到/清会话确认——都在右侧
 * slide-over 内完成，不再使用整页切换或原生 window.confirm。
 *
 * renderedPanel/renderedConfirm 记住关闭前的内容，使 slide-over 退场动画期间
 * 不闪空（headlessui transition 在 open=false 时仍挂载至动画结束）。
 */
export function SitesPage({ onOpenEmbedded }: { onOpenEmbedded: (request: EmbeddedRequest) => void }): React.JSX.Element {
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [summaries, setSummaries] = useState<Map<string, SiteSummary>>(new Map());
  const [filter, setFilter] = useState<SiteFilter>(DEFAULT_SITE_FILTER);
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [authIdentities, setAuthIdentities] = useState<AuthIdentity[]>([]);
  const [view, setView] = useState<'grid' | 'detail'>('grid');
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<AccountSnapshot[]>([]);
  const [capabilities, setCapabilities] = useState<AccountPageCapabilities | null>(null);
  const [checkInResult, setCheckInResult] = useState<CheckInResult | null>(null);
  const [loginMessage, setLoginMessage] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [isBusy, setIsBusy] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const lastPanel = useRef<Panel | null>(null);
  const lastConfirm = useRef<ConfirmSpec | null>(null);
  if (panel) lastPanel.current = panel;
  if (confirm) lastConfirm.current = confirm;
  const renderedPanel = panel ?? lastPanel.current;
  const renderedConfirm = confirm ?? lastConfirm.current;

  const selectedSite = sites.find(site => site.id === selectedSiteId) ?? null;
  const siteAccounts = accounts.filter(account => account.siteId === selectedSiteId);
  const selectedAccount = siteAccounts.find(account => account.id === selectedAccountId) ?? null;

  const load = async (): Promise<void> => {
    const [nextSites, nextAccounts, nextAuth, nextSummaries] = await Promise.all([
      window.apinest.sites.list(), window.apinest.accounts.list(),
      window.apinest.authIdentities.list(), window.apinest.sites.getSummaries(),
    ]);
    setSites(nextSites);
    setAccounts(nextAccounts);
    setAuthIdentities(nextAuth);
    setSummaries(new Map(nextSummaries.map(item => [item.siteId, item])));
  };

  useEffect(() => {
    load().catch(error => setErrorMessage(getSafeErrorMessage(error))).finally(() => setIsBusy(false));
  }, []);

  useEffect(() => {
    if (!selectedAccountId) {
      setSnapshots([]); setCapabilities(null); setCheckInResult(null); return;
    }
    let cancelled = false;
    Promise.all([
      window.apinest.accounts.getSnapshots(selectedAccountId),
      window.apinest.accounts.getCapabilities(selectedAccountId),
    ]).then(([nextSnapshots, nextCapabilities]) => {
      if (!cancelled) { setSnapshots(nextSnapshots); setCapabilities(nextCapabilities); }
    }).catch(error => { if (!cancelled) setErrorMessage(getSafeErrorMessage(error)); });
    return () => { cancelled = true; };
  }, [selectedAccountId]);

  const run = async (action: () => Promise<void>): Promise<void> => {
    setIsBusy(true); setErrorMessage(null); setMessage(null);
    try { await action(); } catch (error) { setErrorMessage(getSafeErrorMessage(error)); } finally { setIsBusy(false); }
  };
  const accountAction = (action: () => Promise<void>): void => { void run(action); };

  const openSite = (site: SiteRecord): void => {
    setSelectedSiteId(site.id);
    const firstAccount = accounts.find(account => account.siteId === site.id);
    setSelectedAccountId(firstAccount?.id ?? null);
    setView('detail');
  };

  const createSite = (values: SiteFormValues): void => {
    void run(async () => {
      const result = await window.apinest.sites.create(toCreateSiteInput(values));
      await load();
      setSelectedSiteId(result.site.id); setSelectedAccountId(result.account.id);
      setPanel(null); setView('detail');
    });
  };

  const updateSite = (values: SiteFormValues): void => {
    if (!selectedSite) return;
    void run(async () => { await window.apinest.sites.update(selectedSite.id, toUpdateSiteInput(values)); await load(); setPanel(null); });
  };

  const createAccount = (values: AccountFormValues): void => {
    if (!selectedSite) return;
    void run(async () => {
      const created = await window.apinest.sites.addAccount(selectedSite.id, toCreateSiteAccountInput(values));
      await load(); setSelectedAccountId(created.id); setPanel(null);
    });
  };

  const updateAccount = (values: AccountFormValues): void => {
    if (!selectedAccount) return;
    void run(async () => {
      await window.apinest.accounts.update(selectedAccount.id, toUpdateAccountInput(values));
      if ((selectedAccount.authRefId ?? '') !== values.authId) await window.apinest.accounts.linkAuth(selectedAccount.id, values.authId || null);
      await load(); setPanel(null);
    });
  };

  const syncSite = (site: SiteRecord): void => {
    setConfirm({
      title: '同步站点账号',
      message: <>确认同步站点「<strong>{site.name}</strong>」下的 {site.accountCount} 个账号？</>,
      detail: '将逐个刷新账号资料与登录状态，可能需要一些时间。',
      confirmLabel: '开始同步',
      onConfirm: () => {
        setConfirm(null);
        void run(async () => {
          const result = await window.apinest.sites.syncAccounts(site.id);
          await load();
          setMessage(`同步完成：共 ${result.total} 个账号，${result.results.filter(item => item.authState !== 'error').length} 个已处理。`);
        });
      },
    });
  };

  const checkInSite = (site: SiteRecord): void => {
    setConfirm({
      title: '批量签到',
      message: <>确认对站点「<strong>{site.name}</strong>」下支持签到的账号执行签到？</>,
      confirmLabel: '开始签到',
      onConfirm: () => {
        setConfirm(null);
        void run(async () => {
          const result = await window.apinest.sites.checkInAccounts(site.id);
          setMessage(`签到完成：成功/已签到 ${result.results.filter(item => item.result === 'success' || item.result === 'already_checked_in').length}，共 ${result.total} 个。`);
        });
      },
    });
  };

  const deleteSite = (site: SiteRecord): void => {
    const count = accounts.filter(account => account.siteId === site.id).length;
    setConfirm({
      title: '删除站点',
      message: <>确认删除站点「<strong>{site.name}</strong>」及其 {count} 个账号、会话与缓存？</>,
      detail: '该操作不可恢复。',
      danger: true,
      confirmLabel: '删除站点',
      onConfirm: () => {
        setConfirm(null);
        void run(async () => {
          await window.apinest.sites.remove(site.id);
          await load();
          setSelectedSiteId(null); setSelectedAccountId(null); setView('grid');
        });
      },
    });
  };

  const openWebsite = (site: SiteRecord): void => {
    void run(async () => { await window.apinest.sites.openWebsite(site.id); });
  };

  const deleteAccount = (account: AccountRecord): void => {
    setConfirm({
      title: '删除账号',
      message: <>确认删除账号「<strong>{account.displayName}</strong>」（{account.baseUrl}）？</>,
      detail: '该账号的网页会话与缓存将被清除，且无法恢复。同一 URL 的其他账号不受影响。',
      danger: true,
      confirmLabel: '删除账号',
      onConfirm: () => {
        setConfirm(null);
        void run(async () => {
          await window.apinest.accounts.remove(account.id);
          const next = accounts.find(item => item.siteId === account.siteId && item.id !== account.id);
          await load();
          setSelectedAccountId(next?.id ?? null);
        });
      },
    });
  };

  const clearAccountSession = (account: AccountRecord): void => {
    setConfirm({
      title: '清除会话',
      message: <>确认清除账号「<strong>{account.displayName}</strong>」的本地会话？</>,
      detail: '清除后该账号下次需要重新登录。',
      confirmLabel: '清除会话',
      onConfirm: () => {
        setConfirm(null);
        void run(async () => { await window.apinest.auth.clearSession(account.id); });
      },
    });
  };

  const panelTitle =
    renderedPanel?.kind === 'create-site' ? '新增站点'
      : renderedPanel?.kind === 'edit-site' ? '编辑站点'
        : renderedPanel?.kind === 'create-account' ? '添加账号'
          : renderedPanel?.kind === 'edit-account' ? '编辑账号'
            : '';

  const panelSubtitle =
    renderedPanel?.kind === 'edit-site' ? selectedSite?.baseUrl
      : renderedPanel?.kind === 'create-account' ? (selectedSite ? `${selectedSite.name} · ${selectedSite.baseUrl}` : undefined)
        : renderedPanel?.kind === 'edit-account' ? selectedAccount?.baseUrl
          : undefined;

  const panelWidth: SlideOverWidth =
    renderedPanel?.kind === 'create-site' || renderedPanel?.kind === 'edit-site' ? 'lg' : 'md';

  const renderPanel = (): React.ReactNode => {
    switch (renderedPanel?.kind) {
      case 'create-site':
        return <SiteForm submitLabel="创建站点" initialValues={EMPTY_SITE_FORM} authIdentities={authIdentities} includeFirstAccount isBusy={isBusy} onDetect={window.apinest.sites.detectPlatform} onSubmit={createSite} onCancel={() => setPanel(null)} />;
      case 'edit-site':
        return selectedSite ? <SiteForm submitLabel="保存" initialValues={siteToFormValues(selectedSite)} authIdentities={authIdentities} includeFirstAccount={false} isBusy={isBusy} onDetect={window.apinest.sites.detectPlatform} onSubmit={updateSite} onCancel={() => setPanel(null)} /> : null;
      case 'create-account':
        return <AccountForm submitLabel="添加" initialValues={EMPTY_ACCOUNT_FORM} authIdentities={authIdentities} isBusy={isBusy} onSubmit={createAccount} onCancel={() => setPanel(null)} />;
      case 'edit-account':
        return selectedAccount ? <AccountForm submitLabel="保存" initialValues={accountToFormValues(selectedAccount)} authIdentities={authIdentities} isBusy={isBusy} onSubmit={updateAccount} onCancel={() => setPanel(null)} /> : null;
      default:
        return null;
    }
  };

  // 站点广场筛选：过滤后的站点列表 + 可选标签集合（来自全部站点，去重保序）。
  const visibleSites = filterSites(sites, summaries, filter);
  const allTags = collectSiteTags(sites);

  return (
    <>
      {view === 'detail' && selectedSite ? (
        <SiteDetail
          site={selectedSite}
          accounts={siteAccounts}
          selectedAccountId={selectedAccountId}
          isBusy={isBusy}
          onBack={() => setView('grid')}
          onEdit={() => setPanel({ kind: 'edit-site' })}
          onDelete={() => deleteSite(selectedSite)}
          onAddAccount={() => setPanel({ kind: 'create-account' })}
          onSelectAccount={id => setSelectedAccountId(id)}
        >
          {selectedAccount ? (
            <AccountDetail
              account={selectedAccount}
              isBusy={isBusy}
              snapshots={snapshots}
              pageCapabilities={capabilities}
              refreshError={null}
              checkInResult={checkInResult}
              loginMessage={loginMessage}
              onEdit={() => setPanel({ kind: 'edit-account' })}
              onCopy={() => accountAction(async () => { const copied = await window.apinest.accounts.copy(selectedAccount.id); await load(); setSelectedAccountId(copied.id); })}
              onDelete={() => deleteAccount(selectedAccount)}
              onRefresh={() => accountAction(async () => { await window.apinest.accounts.refresh(selectedAccount.id); setSnapshots(await window.apinest.accounts.getSnapshots(selectedAccount.id)); })}
              onOpenLogin={() => accountAction(async () => {
                setLoginMessage('正在登录…');
                try {
                  const result = await window.apinest.auth.openLogin(selectedAccount.id, 'auto');
                  setLoginMessage(result.message);
                  await load();
                  setSnapshots(await window.apinest.accounts.getSnapshots(selectedAccount.id));
                } catch (error) {
                  setLoginMessage(getSafeErrorMessage(error));
                  throw error;
                }
              })}
              onCheckIn={() => accountAction(async () => { setCheckInResult(await window.apinest.checkIn.runOne(selectedAccount.id)); })}
              onOpenInApp={page => onOpenEmbedded({ accountId: selectedAccount.id, page, title: `${selectedSite.name} · ${selectedAccount.displayName} · ${PAGE_TITLES[page]}` })}
              onOpenExternal={page => accountAction(async () => { await window.apinest.pages.openExternal(selectedAccount.id, page); })}
              onClearSession={() => clearAccountSession(selectedAccount)}
              authIdentities={authIdentities}
              onLinkAuth={authId => accountAction(async () => { await window.apinest.accounts.linkAuth(selectedAccount.id, authId); await load(); })}
              onImportCookies={async cookieHeader => {
                setLoginMessage(null);
                const result = await window.apinest.auth.importCookies(selectedAccount.id, cookieHeader);
                setLoginMessage(result.message);
                await load();
              }}
            />
          ) : (
            <p className="empty-state">选择或添加一个账号。</p>
          )}
        </SiteDetail>
      ) : (
        <section className="sites-page">
          <div className="sites-page-header">
            <h2>站点广场</h2>
            <button type="button" disabled={isBusy} onClick={() => setPanel({ kind: 'create-site' })}>＋ 新增站点</button>
          </div>
          <div className="sites-toolbar">
            <input
              className="sites-search"
              type="search"
              value={filter.keyword}
              placeholder="搜索站名或网址"
              onChange={e => setFilter(current => ({ ...current, keyword: e.target.value }))}
            />
            <label className="sites-toolbar-toggle">
              <input
                type="checkbox"
                checked={filter.onlyEnabled}
                onChange={e => setFilter(current => ({ ...current, onlyEnabled: e.target.checked }))}
              />
              仅启用
            </label>
            <label className="sites-toolbar-toggle">
              <input
                type="checkbox"
                checked={filter.notCheckedInToday}
                onChange={e => setFilter(current => ({ ...current, notCheckedInToday: e.target.checked }))}
              />
              今日未签到
            </label>
            {allTags.length > 0 ? (
              <div className="sites-tag-filter">
                {allTags.map(tag => {
                  const active = filter.tags.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      className={`sites-tag-filter-chip${active ? ' active' : ''}`}
                      aria-pressed={active}
                      onClick={() => setFilter(current => ({
                        ...current,
                        tags: active ? current.tags.filter(item => item !== tag) : [...current.tags, tag],
                      }))}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          {errorMessage ? <p className="error-message">{errorMessage}</p> : null}
          {message ? <p className="hint">{message}</p> : null}
          <SiteGrid sites={visibleSites} accounts={accounts} summaries={summaries} isBusy={isBusy} onOpen={openSite} onEdit={site => { setSelectedSiteId(site.id); setPanel({ kind: 'edit-site' }); }} onSync={syncSite} onCheckIn={checkInSite} onDelete={deleteSite} onOpenWebsite={openWebsite} />
        </section>
      )}

      <SlideOver open={panel !== null} onClose={() => setPanel(null)} title={panelTitle} subtitle={panelSubtitle} width={panelWidth}>
        {renderPanel()}
      </SlideOver>

      <ConfirmSlideOver
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={() => renderedConfirm?.onConfirm()}
        title={renderedConfirm?.title ?? ''}
        message={renderedConfirm?.message ?? ''}
        detail={renderedConfirm?.detail}
        danger={renderedConfirm?.danger}
        confirmLabel={renderedConfirm?.confirmLabel}
        busy={isBusy}
      />
    </>
  );
}
