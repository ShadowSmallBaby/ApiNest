import { describe, expect, it } from 'vitest';
import type { AccountRecord, SiteRecord } from '../../shared/ipc/bridge';
import {
  resolveSiteOAuthProviders,
  selectBatchCheckInAccountIds,
  selectBatchLoginAccountIds,
} from './batch-eligibility';

function site(overrides: Partial<SiteRecord> & Pick<SiteRecord, 'id'>): SiteRecord {
  return {
    name: overrides.id,
    platform: 'newapi',
    baseUrl: 'https://example.com',
    routeProfile: 'modern',
    useProxy: false,
    enabled: true,
    tags: [],
    autoLogin: false,
    autoCheckIn: false,
    accountCount: 1,
    ...overrides,
  };
}

function account(
  overrides: Partial<AccountRecord> & Pick<AccountRecord, 'id' | 'siteId'>,
): AccountRecord {
  return {
    platform: 'newapi',
    baseUrl: 'https://example.com',
    displayName: overrides.id,
    authState: 'unknown',
    authRefId: null,
    ...overrides,
  };
}

describe('selectBatchLoginAccountIds', () => {
  const sites = [
    site({ id: 's-on', autoLogin: true, enabled: true }),
    site({ id: 's-off', autoLogin: false, enabled: true }),
    site({ id: 's-disabled', autoLogin: true, enabled: false }),
  ];
  const identityKindById = new Map([
    ['auth-gh', 'github' as const],
    ['auth-ld', 'linuxdo' as const],
    ['auth-pw', 'password' as const],
  ]);
  const oauthProvidersBySiteId = new Map([
    ['s-on', new Set(['github' as const, 'linuxdo' as const])],
    ['s-off', new Set(['github' as const])],
    ['s-disabled', new Set(['github' as const])],
  ]);

  it('only includes expired accounts on enabled autoLogin sites with matching oauth', () => {
    const accounts = [
      account({ id: 'a1', siteId: 's-on', authState: 'expired', authRefId: 'auth-gh' }),
      account({ id: 'a2', siteId: 's-on', authState: 'active', authRefId: 'auth-gh' }),
      account({ id: 'a3', siteId: 's-on', authState: 'unknown', authRefId: null }),
      account({ id: 'a4', siteId: 's-on', authState: 'error', authRefId: 'auth-pw' }),
      account({ id: 'a5', siteId: 's-off', authState: 'expired', authRefId: 'auth-gh' }),
      account({ id: 'a6', siteId: 's-disabled', authState: 'expired', authRefId: 'auth-gh' }),
      account({ id: 'a7', siteId: 's-on', authState: 'expired', authRefId: 'auth-ld' }),
    ];

    expect(
      selectBatchLoginAccountIds({
        sites,
        accounts,
        identityKindById,
        oauthProvidersBySiteId,
      }),
    ).toEqual(['a1', 'a7']);
  });

  it('skips accounts when site lacks the identity provider config', () => {
    expect(
      selectBatchLoginAccountIds({
        sites: [site({ id: 's-on', autoLogin: true })],
        accounts: [
          account({ id: 'a1', siteId: 's-on', authState: 'expired', authRefId: 'auth-gh' }),
        ],
        identityKindById,
        oauthProvidersBySiteId: new Map([['s-on', new Set(['linuxdo' as const])]]),
      }),
    ).toEqual([]);
  });
});

describe('selectBatchCheckInAccountIds', () => {
  it('filters by autoCheckIn, active session, not checked-in today, and capability', () => {
    const sites = [
      site({ id: 's1', autoCheckIn: true, enabled: true }),
      site({ id: 's2', autoCheckIn: true, enabled: true, checkInSiteUrl: 'https://checkin.example.com' }),
      site({ id: 's3', autoCheckIn: false, enabled: true }),
    ];
    const accounts = [
      account({ id: 'a1', siteId: 's1', authState: 'active' }),
      account({ id: 'a2', siteId: 's1', authState: 'expired' }),
      account({ id: 'a3', siteId: 's1', authState: 'active' }),
      account({ id: 'a4', siteId: 's2', authState: 'active' }),
      account({ id: 'a5', siteId: 's3', authState: 'active' }),
    ];

    expect(
      selectBatchCheckInAccountIds({
        sites,
        accounts,
        checkedInAccountIdsToday: new Set(['a3']),
        checkInCapableAccountIds: new Set(['a1', 'a2', 'a3', 'a4', 'a5']),
      }),
    ).toEqual(['a1']);
  });
});

describe('resolveSiteOAuthProviders', () => {
  it('merges configured providers with legacy linuxDoClientId', () => {
    expect(
      [...resolveSiteOAuthProviders({ id: 's', linuxDoClientId: 'ld' }, ['github'])].sort(),
    ).toEqual(['github', 'linuxdo']);
    expect([...resolveSiteOAuthProviders({ id: 's' }, ['github'])]).toEqual(['github']);
  });
});
