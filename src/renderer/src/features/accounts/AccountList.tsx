import type { AccountRecord } from '../../../../shared/ipc/bridge';

const AUTH_STATE_LABELS: Record<AccountRecord['authState'], string> = {
  unknown: '未知',
  active: '有效',
  expired: '已过期',
  error: '异常',
};

interface AccountListProps {
  accounts: AccountRecord[];
  selectedId: string | null;
  isBusy: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

export function AccountList({
  accounts,
  selectedId,
  isBusy,
  onSelect,
  onCreate,
}: AccountListProps): React.JSX.Element {
  return (
    <div className="account-list">
      <div className="account-list-header">
        <h2>账户</h2>
        <button type="button" onClick={onCreate} disabled={isBusy}>
          ＋ 新建账户
        </button>
      </div>
      {accounts.length === 0 ? (
        <p className="empty-state">还没有账户。点击“新建账户”开始添加同一站点的多个账户。</p>
      ) : (
        <ul>
          {accounts.map(account => (
            <li key={account.id}>
              <button
                type="button"
                className={account.id === selectedId ? 'account-item selected' : 'account-item'}
                onClick={() => onSelect(account.id)}
              >
                <span className="account-item-name">{account.displayName}</span>
                <span className="account-item-meta">
                  {account.siteName} · {account.displayName}
                </span>
                <span className={`auth-badge auth-${account.authState}`}>
                  {AUTH_STATE_LABELS[account.authState]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
