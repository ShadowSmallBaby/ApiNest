import { useEffect, useState } from 'react';
import type { KnownPage } from '../../../shared/ipc/bridge';
import { SitesPage } from '../features/sites/SitesPage';
import { KeysPage } from '../features/keys/KeysPage';
import { ModelsPage } from '../features/models/ModelsPage';
import { LogsPage } from '../features/logs/LogsPage';
import { TextApiTestPage } from '../features/api-test/TextApiTestPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { ComingSoonPage } from './ComingSoonPage';
import { EmbeddedBrowserHost } from './EmbeddedBrowserHost';
import { OAuthPage } from './OAuthPage';
import { SettingsPage } from './SettingsPage';
import { TitleBar } from './TitleBar';
import { CollapseIcon, LockIcon, NavIcon, SettingsGearIcon } from '../components/icons';
import { NAV_ITEMS, type NavItem, type NavKey } from './navigation';

/** 侧栏折叠态的 localStorage 键；仅存 '0'/'1'，非敏感。 */
const SIDEBAR_COLLAPSED_KEY = 'apinest.sidebar.collapsed';

/**
 * 系统设置项。settings 不在 NAV_ITEMS（主导航）中，由侧栏底部齿轮触发，
 * 故单列一个 NavItem 供 activeItem 推导与内容渲染，避免 fallback 回仪表盘。
 */
const SETTINGS_ITEM: NavItem = { key: 'settings', label: '系统设置', implemented: true };

interface AppShellProps {
  version: string;
  isBusy: boolean;
  onLock: () => void;
}

/** 当前内嵌浏览请求（全局单例）。 */
export interface EmbeddedRequest {
  accountId: string;
  page: KnownPage;
  title: string;
}

function renderContent(
  item: NavItem,
  props: AppShellProps,
  onOpenEmbedded: (request: EmbeddedRequest) => void,
): React.JSX.Element {
  if (!item.implemented) {
    return <ComingSoonPage title={item.label} />;
  }

  switch (item.key) {
    case 'dashboard':
      return <DashboardPage />;
    case 'sites':
      return <SitesPage onOpenEmbedded={onOpenEmbedded} />;
    case 'keys':
      return <KeysPage />;
    case 'models':
      return <ModelsPage />;
    case 'logs':
      return <LogsPage />;
    case 'test':
      return <TextApiTestPage />;
    case 'oauth':
      return <OAuthPage isBusy={props.isBusy} />;
    case 'settings':
      return <SettingsPage version={props.version} isBusy={props.isBusy} onLock={props.onLock} />;
    default:
      return <ComingSoonPage title={item.label} />;
  }
}

/**
 * 解锁后的主外壳：顶部自绘标题栏，下方为左侧导航 + 右侧内容区。
 * 导航仅切换 renderer 视图，不触及主进程；未实现能力进入占位页。
 *
 * 左导航为 Windows 11 NavigationView 风格：品牌区 + 图标导航 + 底部账号摘要，
 * 摘要在每次切换导航时刷新，反映站点页的账号增删（本地查询，开销可忽略）。
 *
 * 内嵌浏览（R11）为全局单例：打开站点页面时右侧内容区整块切换为
 * EmbeddedBrowserHost，底层原页面 DOM 不再渲染，避免露内容与多余滚动条；
 * 返回或切换导航项都会卸载 host，其 cleanup 负责销毁内嵌视图，杜绝泄漏。
 */
export function AppShell(props: AppShellProps): React.JSX.Element {
  const [activeKey, setActiveKey] = useState<NavKey>('dashboard');
  const [embedded, setEmbedded] = useState<EmbeddedRequest | null>(null);
  // 侧栏折叠态持久化到 localStorage，重开应用保持上次选择。
  const [collapsed, setCollapsed] = useState<boolean>(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1',
  );
  // settings 不在主导航列表，单独兜底为 SETTINGS_ITEM，否则 find 落空会 fallback 回仪表盘。
  const activeItem =
    activeKey === 'settings'
      ? SETTINGS_ITEM
      : NAV_ITEMS.find(item => item.key === activeKey) ?? NAV_ITEMS[0];

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  const handleSelectNav = (key: NavKey): void => {
    // 切换导航先关闭内嵌浏览：host 卸载时会销毁内嵌视图（单例生命周期）。
    setEmbedded(null);
    setActiveKey(key);
  };

  const isEmbedded = embedded !== null;

  return (
    <div className="app-shell-root">
      <TitleBar />
      <div className="app-shell-body">
        <aside className={`app-sidebar${collapsed ? ' app-sidebar--collapsed' : ''}`}>
          <nav className="app-nav">
            {NAV_ITEMS.map(item => (
              <button
                key={item.key}
                type="button"
                className={`app-nav-item${item.key === activeKey ? ' active' : ''}`}
                title={item.label}
                onClick={() => handleSelectNav(item.key)}
              >
                <span className="app-nav-icon">
                  <NavIcon name={item.key} />
                </span>
                <span className="app-nav-label">{item.label}</span>
                {!item.implemented ? <span className="nav-badge">待推出</span> : null}
              </button>
            ))}
          </nav>

          <div className="sidebar-footer">
            <div className="sidebar-footer-row">
              <button
                type="button"
                className={`sidebar-icon-button${activeKey === 'settings' ? ' active' : ''}`}
                aria-label="系统设置"
                title="系统设置"
                onClick={() => handleSelectNav('settings')}
              >
                <SettingsGearIcon />
              </button>
              <button
                type="button"
                className="sidebar-icon-button"
                aria-label="锁定"
                title="锁定"
                onClick={props.onLock}
                disabled={props.isBusy}
              >
                <LockIcon />
              </button>
              <button
                type="button"
                className="sidebar-icon-button"
                aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
                title={collapsed ? '展开侧栏' : '收起侧栏'}
                aria-pressed={collapsed}
                onClick={() => setCollapsed(current => !current)}
              >
                <CollapseIcon collapsed={collapsed} />
              </button>
            </div>
          </div>
        </aside>

        <main className={`app-content${isEmbedded ? ' app-content--embedded' : ''}`}>
          {embedded ? (
            <EmbeddedBrowserHost
              accountId={embedded.accountId}
              page={embedded.page}
              title={embedded.title}
              onBack={() => setEmbedded(null)}
            />
          ) : (
            renderContent(activeItem, props, setEmbedded)
          )}
        </main>
      </div>
    </div>
  );
}
