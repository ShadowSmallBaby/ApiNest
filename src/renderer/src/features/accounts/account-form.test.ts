import { describe, expect, it } from 'vitest';
import type { AccountRecord, AuthIdentity } from '../../../../shared/ipc/bridge';
import {
  EMPTY_ACCOUNT_FORM,
  accountToFormValues,
  filterAuthIdentitiesForSite,
  toCreateAccountInput,
  toUpdateAccountInput,
  validateAccountForm,
} from './account-form';

const identities: AuthIdentity[] = [
  {
    id: 'gh-1',
    kind: 'github',
    label: 'GH',
    hasCredential: false,
    useProxy: false,
    createdAt: '',
  },
  {
    id: 'ld-1',
    kind: 'linuxdo',
    label: 'LD',
    hasCredential: false,
    useProxy: false,
    createdAt: '',
  },
  {
    id: 'pw-1',
    kind: 'password',
    label: 'PWD',
    hasCredential: true,
    useProxy: false,
    createdAt: '',
  },
];

describe('account-form', () => {
  it('requires an account display name', () => {
    expect(validateAccountForm(EMPTY_ACCOUNT_FORM)).toBe('请填写账号显示名。');
  });

  it('accepts a valid account-only form', () => {
    expect(validateAccountForm({ displayName: 'Account A', note: '', authId: '' })).toBeNull();
  });

  it('requires auth when autoLogin is enabled', () => {
    expect(
      validateAccountForm({ displayName: 'Account A', note: '', authId: '' }, { requireAuthId: true }),
    ).toBe('启用自动登录时必须绑定 OAuth 身份（不可使用 CK 认证）。');
  });

  it('filters auth identities only when autoLogin is enabled', () => {
    expect(
      filterAuthIdentitiesForSite(identities, { autoLogin: false, configuredProviders: ['github'] }),
    ).toEqual({ allowCookie: true, identities });

    const filtered = filterAuthIdentitiesForSite(identities, {
      autoLogin: true,
      configuredProviders: ['github'],
    });
    expect(filtered.allowCookie).toBe(false);
    expect(filtered.identities.map(item => item.id)).toEqual(['gh-1']);
  });

  it('maps account fields without carrying site configuration', () => {
    expect(toCreateAccountInput('11111111-1111-4111-8111-111111111111', {
      displayName: '  Account A  ', note: '   ', authId: '',
    })).toEqual({
      siteId: '11111111-1111-4111-8111-111111111111',
      displayName: 'Account A', note: undefined, authId: null,
    });
    expect(toUpdateAccountInput({ displayName: 'Account A', note: 'note', authId: 'ignored' })).toEqual({
      displayName: 'Account A', note: 'note',
    });
  });

  it('round-trips account-specific values from an account record', () => {
    const account: AccountRecord = {
      id: '11111111-1111-4111-8111-111111111111',
      siteId: '22222222-2222-4222-8222-222222222222',
      siteName: 'Site',
      platform: 'newapi',
      baseUrl: 'https://example.com/',
      routeProfile: 'modern',
      displayName: 'Account A', note: 'note', authState: 'unknown', authRefId: 'auth-id',
    };
    expect(accountToFormValues(account)).toEqual({ displayName: 'Account A', note: 'note', authId: 'auth-id' });
  });
});
