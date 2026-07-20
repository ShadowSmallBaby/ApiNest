import { describe, expect, it } from 'vitest';
import { resolveLinuxDoOAuthPlan } from './linuxdo-oauth';

const account = {
  id: '11111111-1111-4111-8111-111111111111',
  platform: 'newapi' as const,
  baseUrl: 'https://newapi.example.com/prefix/',
  displayName: 'Account A',
  linuxDoClientId: 'client-id',
};

describe('resolveLinuxDoOAuthPlan', () => {
  it('uses only the target site confirmed OAuth entry and trusted hosts', () => {
    const plan = resolveLinuxDoOAuthPlan(account);

    expect(plan).toEqual({
      startUrl: new URL('https://newapi.example.com/sign-in'),
      oauthDomains: ['connect.linux.do'],
      redirectDomains: ['newapi.example.com'],
    });
  });

  it('refuses missing client id, another platform, or invalid base url', () => {
    expect(resolveLinuxDoOAuthPlan({ ...account, linuxDoClientId: undefined })).toBeNull();
    expect(resolveLinuxDoOAuthPlan({ ...account, platform: 'sub2api' })).toBeNull();
    expect(resolveLinuxDoOAuthPlan({ ...account, baseUrl: 'not-a-url' })).toBeNull();
  });
});
