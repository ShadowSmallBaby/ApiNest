import type {
  AccountRecord,
  AuthIdentity,
  OAuthProvider,
} from '../../../../shared/ipc/bridge';
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

/**
 * 按站点自动登录配置过滤可选认证身份。
 * - autoLogin 关闭：允许 CK，身份列表不过滤
 * - autoLogin 开启：禁止 CK，仅 github/linuxdo 且属于站点已配置 provider 的身份
 */
export function filterAuthIdentitiesForSite(
  identities: AuthIdentity[],
  options: {
    autoLogin: boolean;
    configuredProviders: OAuthProvider[];
  },
): { allowCookie: boolean; identities: AuthIdentity[] } {
  if (!options.autoLogin) {
    return { allowCookie: true, identities };
  }
  const providers = new Set(options.configuredProviders);
  return {
    allowCookie: false,
    identities: identities.filter(
      identity =>
        (identity.kind === 'github' || identity.kind === 'linuxdo') &&
        providers.has(identity.kind),
    ),
  };
}

export function validateAccountForm(
  values: AccountFormValues,
  options?: { requireAuthId?: boolean },
): string | null {
  if (values.displayName.trim().length === 0) {
    return '请填写账号显示名。';
  }
  if (values.displayName.trim().length > 120) {
    return '账号显示名不能超过 120 个字符。';
  }
  if (values.note.trim().length > 1000) {
    return '账号备注不能超过 1000 个字符。';
  }
  if (options?.requireAuthId && !values.authId) {
    return '启用自动登录时必须绑定 OAuth 身份（不可使用 CK 认证）。';
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
