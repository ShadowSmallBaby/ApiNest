import type { AccountRecord, SiteRecord } from '../../../../shared/ipc/bridge';
import { routeProfileLabel } from './site-card-view';

interface SiteDetailProps {
  site: SiteRecord;
  accounts: AccountRecord[];
  selectedAccountId: string | null;
  isBusy: boolean;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddAccount: () => void;
  onSelectAccount: (accountId: string) => void;
  children: React.ReactNode;
}

export function SiteDetail(props: SiteDetailProps): React.JSX.Element {
  return (
    <section className="site-detail-page">
      <div className="site-detail-header">
        <div>
          <button type="button" className="secondary-button" onClick={props.onBack}>← 返回广场</button>
          <p className="eyebrow">站点详情</p>
          <h2>{props.site.name}</h2>
          <p className="site-card-url">{props.site.baseUrl}</p>
        </div>
        <div className="detail-actions">
          <button type="button" onClick={props.onEdit} disabled={props.isBusy}>编辑站点</button>
          <button type="button" className="danger-button" onClick={props.onDelete} disabled={props.isBusy}>删除站点</button>
        </div>
      </div>

      <dl className="detail-grid site-meta-grid">
        <div><dt>平台</dt><dd>{props.site.platform}</dd></div>
        <div><dt>页面路由</dt><dd>{routeProfileLabel(props.site)}</dd></div>
        <div><dt>账号数量</dt><dd>{props.accounts.length}</dd></div>
        <div><dt>备注</dt><dd>{props.site.note ?? '—'}</dd></div>
      </dl>

      <div className="site-accounts-layout">
        <aside className="site-account-list">
          <div className="account-list-header">
            <h3>账号</h3>
            <button type="button" onClick={props.onAddAccount} disabled={props.isBusy}>＋ 添加</button>
          </div>
          {props.accounts.length === 0 ? <p className="empty-state">该站点暂无账号。</p> : (
            <ul>
              {props.accounts.map(account => (
                <li key={account.id}>
                  <button
                    type="button"
                    className={account.id === props.selectedAccountId ? 'account-item selected' : 'account-item'}
                    onClick={() => props.onSelectAccount(account.id)}
                  >
                    <span className="account-item-name">{account.displayName}</span>
                    <span className={`auth-badge auth-${account.authState}`}>{account.authState}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <div className="site-account-detail">{props.children}</div>
      </div>
    </section>
  );
}
