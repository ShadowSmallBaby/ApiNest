import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import type { AccountRecord, SiteRecord, SiteSummary } from '../../../../shared/ipc/bridge';
import { ExternalLinkIcon, KebabIcon } from '../../components/icons';
import {
  balanceTotalLabel,
  buildSiteCardView,
  overallStatusLabel,
  platformLabel,
} from './site-card-view';

interface SiteCardProps {
  site: SiteRecord;
  accounts: AccountRecord[];
  summary?: SiteSummary;
  isBusy: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onSync: () => void;
  onCheckIn: () => void;
  onDelete: () => void;
  onOpenWebsite: () => void;
}

/**
 * 站点广场卡片。头部为站名 + kebab 菜单（打开/同步/签到/编辑/删除），下接平台徽章
 * 与官网外链、状态圆点 + 账号数、余额合计、今日签到 x/y。禁用站点整体灰化并加角标。
 * 卡片本体可点/键盘打开详情，kebab 与官网按钮阻止冒泡以免误触发打开。
 */
export function SiteCard(props: SiteCardProps): React.JSX.Element {
  const view = buildSiteCardView(props.site, props.accounts, props.summary);
  const disabled = props.site.enabled === false;
  const stop = (callback: () => void) => (event: React.MouseEvent): void => {
    event.stopPropagation();
    callback();
  };
  const noAccounts = view.accountCount === 0;

  return (
    <article
      className={`site-card${disabled ? ' site-card--disabled' : ''}`}
      role="button"
      aria-label={`打开站点 ${props.site.name} 的详情`}
      onClick={props.onOpen}
      tabIndex={0}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          props.onOpen();
        }
        if (event.key === ' ') {
          event.preventDefault();
          props.onOpen();
        }
      }}
    >
      <div className="site-card-head">
        <h3>{props.site.name}</h3>
        <div className="site-card-head-right">
          {disabled ? <span className="site-card-disabled-tag">已禁用</span> : null}
          <Menu>
            <MenuButton
              className="site-card-menu-button"
              aria-label="更多操作"
              disabled={props.isBusy}
              onClick={event => event.stopPropagation()}
            >
              <KebabIcon />
            </MenuButton>
            <MenuItems anchor="bottom end" className="site-card-menu">
              <MenuItem>
                <button type="button" className="site-card-menu-item" onClick={stop(props.onOpen)}>打开</button>
              </MenuItem>
              <MenuItem>
                <button type="button" className="site-card-menu-item" disabled={noAccounts} onClick={stop(props.onSync)}>同步</button>
              </MenuItem>
              <MenuItem>
                <button type="button" className="site-card-menu-item" disabled={noAccounts} onClick={stop(props.onCheckIn)}>签到</button>
              </MenuItem>
              <MenuItem>
                <button type="button" className="site-card-menu-item" onClick={stop(props.onEdit)}>编辑</button>
              </MenuItem>
              <MenuItem>
                <button type="button" className="site-card-menu-item danger" onClick={stop(props.onDelete)}>删除</button>
              </MenuItem>
            </MenuItems>
          </Menu>
        </div>
      </div>

      <div className="site-card-meta-row">
        <span className={`platform-badge platform-${props.site.platform}`}>{platformLabel(props.site)}</span>
        <button type="button" className="site-card-website" onClick={stop(props.onOpenWebsite)} title="在系统浏览器打开官网">
          官网 <ExternalLinkIcon />
        </button>
      </div>

      <p className="site-card-status">
        <span className={`site-status-dot status-${view.overallStatus}`} aria-hidden />
        {overallStatusLabel(view.overallStatus)} · {view.accountCount} 个账号
      </p>

      <p className="site-card-balance">{balanceTotalLabel(view.balanceTotal)}</p>

      {props.site.tags.length > 0 ? (
        <div className="site-card-tags">
          {props.site.tags.map(tag => (
            <span key={tag} className="site-tag-chip">{tag}</span>
          ))}
        </div>
      ) : null}

      <p className="site-card-checkin">签到 {view.checkedInToday}/{view.accountCount}</p>
    </article>
  );
}
