import { useState } from 'react';
import type { AuthIdentity, OAuthProvider } from '../../../../shared/ipc/bridge';
import {
  AccountFormValues,
  authIdentityLabel,
  filterAuthIdentitiesForSite,
  validateAccountForm,
} from './account-form';

interface AccountFormProps {
  submitLabel: string;
  initialValues: AccountFormValues;
  authIdentities: AuthIdentity[];
  /** 站点是否开启自动登录；开启后禁止 CK 并过滤 OAuth 身份。 */
  autoLogin?: boolean;
  /** 站点已配置的 OAuth 提供商列表（autoLogin 时用于过滤）。 */
  configuredProviders?: OAuthProvider[];
  isBusy: boolean;
  onSubmit: (values: AccountFormValues) => void;
  onCancel: () => void;
}

/**
 * 账号新增/编辑表单（承载于右侧 slide-over）。
 * 标题由 slide-over header 提供，故本组件不再自带 `<h2>`。
 */
export function AccountForm({
  submitLabel,
  initialValues,
  authIdentities,
  autoLogin = false,
  configuredProviders = [],
  isBusy,
  onSubmit,
  onCancel,
}: AccountFormProps): React.JSX.Element {
  const [values, setValues] = useState<AccountFormValues>(initialValues);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const authFilter = filterAuthIdentitiesForSite(authIdentities, {
    autoLogin,
    configuredProviders,
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const validationError = validateAccountForm(values, { requireAuthId: autoLogin });
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }
    setErrorMessage(null);
    onSubmit(values);
  };

  return (
    <form className="account-form-panel" onSubmit={handleSubmit}>
      <label htmlFor="account-display-name">账号显示名</label>
      <input
        id="account-display-name"
        type="text"
        value={values.displayName}
        disabled={isBusy}
        placeholder="如：主账号"
        onChange={event => setValues(current => ({ ...current, displayName: event.target.value }))}
      />

      <label htmlFor="account-note">账号备注（可选）</label>
      <textarea
        id="account-note"
        value={values.note}
        disabled={isBusy}
        rows={2}
        onChange={event => setValues(current => ({ ...current, note: event.target.value }))}
      />

      <label htmlFor="account-auth">认证方式</label>
      <select
        id="account-auth"
        value={values.authId}
        disabled={isBusy}
        onChange={event => setValues(current => ({ ...current, authId: event.target.value }))}
      >
        {authFilter.allowCookie ? <option value="">CK 认证</option> : null}
        {authFilter.identities.map(identity => (
          <option key={identity.id} value={identity.id}>
            {authIdentityLabel(identity)}
          </option>
        ))}
      </select>
      <p className="hint">
        {autoLogin
          ? '站点已启用自动登录：仅可选择本站已配置 OAuth 对应的身份，不可使用 CK。'
          : 'CK 认证可在账户详情页导入 Cookie；OAuth 身份依赖站点已配置的对应 Client ID。'}
      </p>

      {errorMessage ? <p className="error-message">{errorMessage}</p> : null}

      <div className="form-actions">
        <button type="button" className="secondary-button" onClick={onCancel} disabled={isBusy}>
          取消
        </button>
        <button type="submit" disabled={isBusy}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
