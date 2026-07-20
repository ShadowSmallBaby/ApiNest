import { useState } from 'react';
import type { AuthIdentity } from '../../../../shared/ipc/bridge';
import {
  AccountFormValues,
  authIdentityLabel,
  validateAccountForm,
} from './account-form';

interface AccountFormProps {
  submitLabel: string;
  initialValues: AccountFormValues;
  authIdentities: AuthIdentity[];
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
  isBusy,
  onSubmit,
  onCancel,
}: AccountFormProps): React.JSX.Element {
  const [values, setValues] = useState<AccountFormValues>(initialValues);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const validationError = validateAccountForm(values);
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

      <label htmlFor="account-auth">绑定认证身份（可选）</label>
      <select
        id="account-auth"
        value={values.authId}
        disabled={isBusy}
        onChange={event => setValues(current => ({ ...current, authId: event.target.value }))}
      >
        <option value="">不绑定</option>
        {authIdentities.map(identity => (
          <option key={identity.id} value={identity.id}>
            {authIdentityLabel(identity)}
          </option>
        ))}
      </select>

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
