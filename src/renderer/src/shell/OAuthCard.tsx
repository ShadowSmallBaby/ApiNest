import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import type { AuthIdentity, AuthLoginTarget } from '../../../shared/ipc/bridge';
import { buildOAuthCardView } from './oauth-card-view';

interface OAuthCardProps {
  identity: AuthIdentity;
  isBusy: boolean;
  /** 打开登录窗体（target 指定站点；default 为各 IdP 起始页）。 */
  onOpenLogin: (target: AuthLoginTarget) => void;
  onEdit: () => void;
  onRemove: () => void;
  onToggleProxy: (useProxy: boolean) => void;
}

/** 三点菜单触发图标（内联 SVG，Fluent 线性风格）。 */
function MoreIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

/**
 * 单个认证身份卡片。
 *
 * 三行布局：类型·名称 + 三点菜单 / 站点 URL（可点打开登录） / 创建时间 + 代理开关。
 * password 类型第二行是说明文字（不可点），无代理开关，菜单只有编辑凭据/删除。
 */
export function OAuthCard({ identity, isBusy, onOpenLogin, onEdit, onRemove, onToggleProxy }: OAuthCardProps): React.JSX.Element {
  const view = buildOAuthCardView(identity);
  const editLabel = identity.kind === 'password' ? '编辑凭据' : '编辑';

  return (
    <article className="oauth-card">
      <div className="oauth-card-row oauth-card-title-row">
        <h3 className="oauth-card-title">{view.title}</h3>
        <Menu>
          <MenuButton className="oauth-card-menu-button" aria-label="更多操作" disabled={isBusy}>
            <MoreIcon />
          </MenuButton>
          <MenuItems anchor="bottom end" className="oauth-card-menu">
            <MenuItem>
              <button type="button" className="oauth-card-menu-item" onClick={onEdit}>
                {editLabel}
              </button>
            </MenuItem>
            {view.loginActions.map(action => (
              <MenuItem key={action.key}>
                <button type="button" className="oauth-card-menu-item" onClick={() => onOpenLogin(action.target)}>
                  {action.label}
                </button>
              </MenuItem>
            ))}
            <MenuItem>
              <button type="button" className="oauth-card-menu-item danger" onClick={onRemove}>
                删除
              </button>
            </MenuItem>
          </MenuItems>
        </Menu>
      </div>

      {view.secondaryClickable ? (
        <button
          type="button"
          className="oauth-card-url"
          disabled={isBusy}
          onClick={() => onOpenLogin(view.primaryLoginTarget)}
          title="点击打开登录窗体"
        >
          {view.secondaryText}
        </button>
      ) : (
        <p className="oauth-card-secondary">
          {view.secondaryText}
          {view.credentialSaved !== null ? (
            <span className={`auth-badge ${view.credentialSaved ? 'auth-active' : 'auth-unknown'}`}>
              {view.credentialSaved ? '已保存' : '未保存'}
            </span>
          ) : null}
        </p>
      )}

      <div className="oauth-card-row oauth-card-foot">
        <span className="oauth-card-time">{view.createdAtText}</span>
        {view.showProxyToggle ? (
          <label className="oauth-card-proxy">
            <input
              type="checkbox"
              checked={identity.useProxy}
              disabled={isBusy}
              onChange={event => onToggleProxy(event.target.checked)}
            />
            全局代理
          </label>
        ) : null}
      </div>
    </article>
  );
}
