import type { AccountRecord, ApiKeyRecord, SiteRecord } from '../../../../shared/ipc/bridge';
import {
  accountsForSite,
  describeKeyStatus,
  describeQuota,
  keyCapableSites,
  loadAccountsKeys,
  reconcileFilters,
  targetAccounts,
} from './keys-view';

const SITE_A = 'site-a';
const SITE_B = 'site-b';

function account(id: string, siteId: string): AccountRecord {
  return {
    id,
    siteId,
    siteName: siteId,
    platform: 'newapi',
    baseUrl: 'https://example.com',
    displayName: id,
    authState: 'unknown',
    authRefId: null,
  };
}

const ACCOUNTS: AccountRecord[] = [
  account('a1', SITE_A),
  account('a2', SITE_A),
  account('b1', SITE_B),
];

describe('accountsForSite', () => {
  it('returns all accounts when site is "all"', () => {
    expect(accountsForSite(ACCOUNTS, 'all')).toHaveLength(3);
  });

  it('returns only the accounts under the given site', () => {
    expect(accountsForSite(ACCOUNTS, SITE_A).map(a => a.id)).toEqual(['a1', 'a2']);
  });
});

describe('targetAccounts', () => {
  it('scopes to the whole site when account is "all"', () => {
    expect(targetAccounts(ACCOUNTS, { siteId: SITE_A, accountId: 'all' }).map(a => a.id)).toEqual([
      'a1',
      'a2',
    ]);
  });

  it('narrows to a single account when chosen', () => {
    expect(targetAccounts(ACCOUNTS, { siteId: SITE_A, accountId: 'a2' }).map(a => a.id)).toEqual([
      'a2',
    ]);
  });

  it('returns all accounts when both filters are "all"', () => {
    expect(targetAccounts(ACCOUNTS, { siteId: 'all', accountId: 'all' })).toHaveLength(3);
  });
});

describe('reconcileFilters', () => {
  it('keeps the account when it belongs to the site', () => {
    const filters = { siteId: SITE_A, accountId: 'a1' as const };
    expect(reconcileFilters(ACCOUNTS, filters)).toEqual(filters);
  });

  it('resets the account to "all" when it is outside the site', () => {
    const filters = { siteId: SITE_A, accountId: 'b1' };
    expect(reconcileFilters(ACCOUNTS, filters)).toEqual({ siteId: SITE_A, accountId: 'all' });
  });

  it('leaves "all" account untouched', () => {
    const filters = { siteId: SITE_B, accountId: 'all' as const };
    expect(reconcileFilters(ACCOUNTS, filters)).toEqual(filters);
  });
});

describe('keyCapableSites', () => {
  it('keeps only newapi sites', () => {
    const sites: SiteRecord[] = [
      { id: SITE_A, name: 'A', platform: 'newapi', baseUrl: 'x', routeProfile: 'modern', accountCount: 1, useProxy: false },
      { id: SITE_B, name: 'B', platform: 'sub2api', baseUrl: 'y', routeProfile: 'modern', accountCount: 1, useProxy: false },
    ];
    expect(keyCapableSites(sites).map(s => s.id)).toEqual([SITE_A]);
  });
});

describe('describeKeyStatus', () => {
  it('maps 1 to 启用 and others to 停用', () => {
    expect(describeKeyStatus(1)).toBe('启用');
    expect(describeKeyStatus(0)).toBe('停用');
    expect(describeKeyStatus(3)).toBe('停用');
  });
});

describe('describeQuota', () => {
  it('shows 无限 for unlimited quota', () => {
    expect(describeQuota({ unlimitedQuota: true, remainQuota: 0 })).toBe('无限');
  });

  it('shows the raw quota otherwise', () => {
    expect(describeQuota({ unlimitedQuota: false, remainQuota: 5000 })).toBe('5000');
  });
});

describe('loadAccountsKeys', () => {
  const accounts = [account('a1', SITE_A), account('a2', SITE_A)];
  const makeKey = (accountId: string): ApiKeyRecord => ({
    id: 1,
    accountId,
    name: 'k',
    maskedKey: 'sk-…',
    remainQuota: 0,
    unlimitedQuota: false,
    usedQuota: 0,
    status: 1,
    createdTime: 0,
    expiredTime: -1,
  });

  it('returns loaded results for every account on success', async () => {
    const results = await loadAccountsKeys(accounts, async id => [makeKey(id)]);
    expect(results.map(r => r.status)).toEqual(['loaded', 'loaded']);
  });

  it('isolates a per-account failure without dropping successful accounts', async () => {
    const results = await loadAccountsKeys(accounts, async id => {
      if (id === 'a2') throw new Error('boom');
      return [makeKey(id)];
    });

    const a1 = results.find(r => r.account.id === 'a1');
    const a2 = results.find(r => r.account.id === 'a2');
    expect(a1?.status).toBe('loaded');
    expect(a1?.status === 'loaded' && a1.keys).toHaveLength(1);
    expect(a2?.status).toBe('error');
    expect(a2?.keys).toEqual([]);
  });

  it('reports all accounts as error when every load fails', async () => {
    const results = await loadAccountsKeys(accounts, async () => {
      throw new Error('x');
    });
    expect(results.map(r => r.status)).toEqual(['error', 'error']);
  });
});
