import { describe, expect, it } from 'vitest';
import type { AccountRecord } from '../../../../shared/ipc/bridge';
import {
  EMPTY_ACCOUNT_FORM,
  accountToFormValues,
  toCreateAccountInput,
  toUpdateAccountInput,
  validateAccountForm,
} from './account-form';

describe('account-form', () => {
  it('requires an account display name', () => {
    expect(validateAccountForm(EMPTY_ACCOUNT_FORM)).toBe('请填写账号显示名。');
  });

  it('accepts a valid account-only form', () => {
    expect(validateAccountForm({ displayName: 'Account A', note: '', authId: '' })).toBeNull();
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
