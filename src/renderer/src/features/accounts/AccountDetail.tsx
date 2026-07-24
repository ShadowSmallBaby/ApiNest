import { useState } from 'react';
import type {
  AccountPageCapabilities,
  AccountRecord,
  AccountSnapshot,
  AuthIdentity,
  AuthState,
  CheckInResult,
  KnownPage,
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
  loginMessage: string | null;
  onEdit: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onRefresh: () => void;
  /** 统一登录：默认 auto（先自动后手动窗口）。 */
  onOpenLogin: () => void;
  onCheckIn: () => void;
  onOpenInApp: (page: KnownPage) => void;
  onOpenExternal: (page: KnownPage) => void;
  onClearSession: () => void;
  authIdentities: AuthIdentity[];
  onLinkAuth: (authId: string | null) => void;
  onImportCookies: (cookieHeader: string) => Promise<void>;
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
 * 账号详情：展示账号身份、缓存快照与账号级操作。
 * 登录为统一入口（自动优先）；支持手动粘贴站点 Cookie。
 */
export function AccountDetail(props: AccountDetailProps): React.JSX.Element {
  const {
    account, isBusy, snapshots, pageCapabilities, refreshError, checkInResult, loginMessage,
    onEdit, onCopy, onDelete, onRefresh, onOpenLogin, onCheckIn,
    onOpenInApp, onOpenExternal, onClearSession, authIdentities, onLinkAuth, onImportCookies,
  } = props;

  const [cookieDraft, setCookieDraft] = useState('');
  const [cookiePending, setCookiePending] = useState(false);
  const [cookieMessage, setCookieMessage] = useState<string | null>(null);
  const [showCookieImport, setShowCookieImport] = useState(false);

  const view = buildAccountSnapshotView(snapshots);
  const caps = pageCapabilities;
  const pages = caps ? (Object.keys(caps.pages) as KnownPage[]) : [];

  const handleImportCookies = async (): Promise<void> => {
    if (cookieDraft.trim().length === 0) {
      return;
    }
    setCookiePending(true);
    setCookieMessage(null);
    try {
      await onImportCookies(cookieDraft.trim());
      setCookieDraft('');
      setCookieMessage('Cookie 已写入本账户会话（值不会回显）。');
    } catch (error) {
      setCookieMessage(error instanceof Error ? error.message : '导入失败');
    } finally {
      setCookiePending(false);
    }
  };

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
      {loginMessage ? <p className="hint">{loginMessage}</p> : null}

      <div className="detail-actions">
        <button type="button" onClick={onRefresh} disabled={isBusy}>刷新数据</button>
        {caps?.checkIn ? (
          <button type="button" className="secondary-button" onClick={onCheckIn} disabled={isBusy}>签到</button>
        ) : null}
        <button type="button" className="secondary-button" onClick={onOpenLogin} disabled={isBusy}>
          {isBusy ? '登录中…' : '登录'}
        </button>
        <button type="button" className="subtle-button" onClick={onClearSession} disabled={isBusy}>
          清除会话
        </button>
        <button
          type="button"
          className="subtle-button"
          onClick={() => setShowCookieImport(open => !open)}
          disabled={isBusy}
        >
          {showCookieImport ? '收起 Cookie' : '手动配置 Cookie'}
        </button>
      </div>

      {showCookieImport ? (
        <div className="settings-field" style={{ marginTop: '0.75rem' }}>
          <label htmlFor={`cookie-import-${account.id}`}>站点 Cookie</label>
          <textarea
            id={`cookie-import-${account.id}`}
            rows={3}
            value={cookieDraft}
            placeholder="session=xxx; 其它键=值（仅写入本账户会话，不会回显）"
            disabled={isBusy || cookiePending}
            onChange={event => setCookieDraft(event.target.value)}
          />
          <p className="hint">
            粘贴浏览器里该站点的 Cookie（name=value; …）。仅导入到本账户隔离会话；请勿粘贴无关站点 Cookie。
          </p>
          <button
            type="button"
            className="secondary-button"
            disabled={isBusy || cookiePending || cookieDraft.trim().length === 0}
            onClick={() => void handleImportCookies()}
          >
            {cookiePending ? '导入中…' : '写入会话'}
          </button>
          {cookieMessage ? <p className="hint">{cookieMessage}</p> : null}
        </div>
      ) : null}

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

/** 供上层把 AuthState 映射为中文时复用（避免重复文案）。 */
export function authStateLabel(state: AuthState): string {
  return AUTH_STATE_LABELS[state];
}
