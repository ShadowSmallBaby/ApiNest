import type {
  AccountPageCapabilities,
  AccountRecord,
  AccountSnapshot,
  AuthIdentity,
  CheckInResult,
  KnownPage,
  LoginMode,
} from '../../../../shared/ipc/bridge';
import { authIdentityLabel } from './account-form';
import { buildAccountSnapshotView, type SnapshotDisplayItem } from './account-snapshot-view';

export interface AccountDetailProps {
  account: AccountRecord;
  isBusy: boolean;
  snapshots: AccountSnapshot[];
  pageCapabilities: AccountPageCapabilities | null;
  refreshError: string | null;
  checkInResult: CheckInResult | null;
  onEdit: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onRefresh: () => void;
  onOpenLogin: (mode: LoginMode) => void;
  onCheckIn: () => void;
  onOpenInApp: (page: KnownPage) => void;
  onOpenExternal: (page: KnownPage) => void;
  onClearSession: () => void;
  authIdentities: AuthIdentity[];
  onLinkAuth: (authId: string | null) => void;
}

const AUTH_STATE_LABELS: Record<AccountRecord['authState'], string> = {
  unknown: '未知',
  active: '有效',
  expired: '已过期',
  error: '异常',
};

const PAGE_LABELS: Record<KnownPage, string> = {
  home: '首页',
  userCenter: '用户中心',
  usage: '用量',
  token: 'Token',
  login: '登录',
};

const CHECKIN_LABELS: Record<CheckInResult['result'], string> = {
  success: '签到成功',
  already_checked_in: '今日已签到',
  unsupported: '该站点不支持签到',
  session_expired: '会话已过期，请重新登录',
  challenge_required: '需人机校验，请打开站点页面完成验证后重试',
  failed: '签到失败',
  cancelled: '已取消',
};

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

function SnapshotCard({ label, item }: { label: string; item: SnapshotDisplayItem }): React.JSX.Element {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{item.value ?? '暂无数据'}</dd>
      {item.fetchedAt ? <span className="field-hint">{formatTime(item.fetchedAt)}</span> : null}
    </div>
  );
}

/**
 * 账号详情：展示账号身份、缓存快照（资料/余额/用量）与账号级操作。
 *
 * 纯展示 + 回调组件——副作用由上层（SitesPage）在 run() 编排中执行，
 * 删除/清会话等确认由上层侧边栏确认承载，本组件只发起意图。
 */
export function AccountDetail(props: AccountDetailProps): React.JSX.Element {
  const {
    account, isBusy, snapshots, pageCapabilities, refreshError, checkInResult,
    onEdit, onCopy, onDelete, onRefresh, onOpenLogin, onCheckIn,
    onOpenInApp, onOpenExternal, onClearSession, authIdentities, onLinkAuth,
  } = props;

  const view = buildAccountSnapshotView(snapshots);
  const caps = pageCapabilities;
  const pages = caps ? (Object.keys(caps.pages) as KnownPage[]) : [];

  return (
    <section className="account-detail">
      <div className="account-detail-header">
        <div>
          <div className="oauth-card-head">
            <h2>{account.displayName}</h2>
            <span className={`auth-badge auth-${account.authState}`}>
              {AUTH_STATE_LABELS[account.authState]}
            </span>
          </div>
          <p className="account-detail-url">{account.baseUrl}</p>
        </div>
        <div className="detail-actions">
          <button type="button" className="secondary-button" onClick={onEdit} disabled={isBusy}>编辑</button>
          <button type="button" className="secondary-button" onClick={onCopy} disabled={isBusy}>复制</button>
          <button type="button" className="danger-button" onClick={onDelete} disabled={isBusy}>删除</button>
        </div>
      </div>

      {account.note ? <p className="hint">{account.note}</p> : null}

      <dl className="detail-grid">
        <SnapshotCard label="用户名" item={view.username} />
        <SnapshotCard label="余额" item={view.balance} />
        <SnapshotCard label="今日用量" item={view.usage} />
      </dl>

      {refreshError ? <p className="error-message">{refreshError}</p> : null}
      {checkInResult ? (
        <p className={checkInResult.result === 'success' || checkInResult.result === 'already_checked_in' ? 'hint' : 'warning-text'}>
          {CHECKIN_LABELS[checkInResult.result]}
        </p>
      ) : null}

      <div className="detail-actions">
        <button type="button" onClick={onRefresh} disabled={isBusy}>刷新数据</button>
        {caps?.checkIn ? (
          <button type="button" className="secondary-button" onClick={onCheckIn} disabled={isBusy}>签到</button>
        ) : null}
        <button type="button" className="secondary-button" onClick={() => onOpenLogin('manual')} disabled={isBusy}>
          应用内登录
        </button>
        {caps?.linuxDoOAuth ? (
          <button type="button" className="secondary-button" onClick={() => onOpenLogin('linuxdo')} disabled={isBusy}>
            LinuxDo 登录
          </button>
        ) : null}
        <button type="button" className="subtle-button" onClick={onClearSession} disabled={isBusy}>
          清除会话
        </button>
      </div>

      {pages.length > 0 ? (
        <div className="future-capabilities">
          <h3>快捷页面</h3>
          <div className="capability-placeholders">
            {pages.map(page => (
              <div key={page} className="field-row">
                <button type="button" className="secondary-button" onClick={() => onOpenInApp(page)} disabled={isBusy}>
                  {PAGE_LABELS[page]}（应用内）
                </button>
                <button type="button" className="subtle-button" onClick={() => onOpenExternal(page)} disabled={isBusy}>
                  外部打开
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="account-auth-link field">
        <label htmlFor="account-link-auth">绑定认证身份</label>
        <select
          id="account-link-auth"
          value={account.authRefId ?? ''}
          disabled={isBusy}
          onChange={event => onLinkAuth(event.target.value || null)}
        >
          <option value="">不绑定</option>
          {authIdentities.map(identity => (
            <option key={identity.id} value={identity.id}>
              {authIdentityLabel(identity)}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}
