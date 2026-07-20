import type { AccountRecord, SiteRecord } from '../../../../shared/ipc/bridge';
import { buildSiteCardView, routeProfileLabel } from './site-card-view';

interface SiteCardProps {
  site: SiteRecord;
  accounts: AccountRecord[];
  isBusy: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onSync: () => void;
  onCheckIn: () => void;
}

export function SiteCard(props: SiteCardProps): React.JSX.Element {
  const view = buildSiteCardView(props.site, props.accounts);
  const action = (callback: () => void) => (event: React.MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    callback();
  };

  return (
    <article
      className="site-card"
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
        <div><h3>{props.site.name}</h3><p>{props.site.platform} · {routeProfileLabel(props.site)}</p></div>
        <span className="site-account-count">{view.accountCount} 个账号</span>
      </div>
      <p className="site-card-url">{props.site.baseUrl}</p>
      <div className="site-health-row">
        <span className="auth-badge auth-active">有效 {view.active}</span>
        <span className="auth-badge auth-expired">过期 {view.expired}</span>
        <span className="auth-badge auth-error">异常 {view.error}</span>
        <span className="auth-badge">未知 {view.unknown}</span>
      </div>
      <div className="site-card-actions">
        <button type="button" disabled={props.isBusy || view.accountCount === 0} onClick={action(props.onSync)}>同步</button>
        <button type="button" disabled={props.isBusy || view.accountCount === 0} onClick={action(props.onCheckIn)}>签到</button>
        <button type="button" className="secondary-button" disabled={props.isBusy} onClick={action(props.onEdit)}>编辑</button>
      </div>
    </article>
  );
}
