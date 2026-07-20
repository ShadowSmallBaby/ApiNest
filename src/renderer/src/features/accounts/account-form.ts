import type { AccountRecord, AuthIdentity } from '../../../../shared/ipc/bridge';
import type { CreateAccountInput, CreateSiteAccountInput, UpdateAccountInput } from '../../../../shared/ipc/schemas';

export interface AccountFormValues {
  displayName: string;
  note: string;
  authId: string;
}

export const EMPTY_ACCOUNT_FORM: AccountFormValues = {
  displayName: '',
  note: '',
  authId: '',
};

export function accountToFormValues(account: AccountRecord): AccountFormValues {
  return {
    displayName: account.displayName,
    note: account.note ?? '',
    authId: account.authRefId ?? '',
  };
}

export function validateAccountForm(values: AccountFormValues): string | null {
  if (values.displayName.trim().length === 0) {
    return '请填写账号显示名。';
  }
  if (values.displayName.trim().length > 120) {
    return '账号显示名不能超过 120 个字符。';
  }
  if (values.note.trim().length > 1000) {
    return '账号备注不能超过 1000 个字符。';
  }
  return null;
}

export function toCreateSiteAccountInput(values: AccountFormValues): CreateSiteAccountInput {
  return {
    displayName: values.displayName.trim(),
    note: values.note.trim() || undefined,
    authId: values.authId || null,
  };
}

export function toCreateAccountInput(siteId: string, values: AccountFormValues): CreateAccountInput {
  return {
    siteId,
    ...toCreateSiteAccountInput(values),
  };
}

export function toUpdateAccountInput(values: AccountFormValues): UpdateAccountInput {
  return {
    displayName: values.displayName.trim(),
    note: values.note.trim() || undefined,
  };
}

export function authIdentityLabel(identity: AuthIdentity): string {
  const kind = identity.kind === 'password' ? '账号密码' : identity.kind === 'github' ? 'GitHub' : 'LinuxDo';
  return `${kind} · ${identity.label}`;
}
