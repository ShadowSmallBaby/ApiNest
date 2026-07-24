import type { AccountRecord, ApiKeyRecord, SiteRecord } from '../../../../shared/ipc/bridge';
import {
  accountsForSite,
  dateToTimestamp,
  describeDuration,
  describeKeyOption,
  describeLogType,
  describeTokenUsage,
  logCapableSites,
  reconcileFilters,
  type LogFilters,
} from './logs-view';

function account(id: string, siteId: string): AccountRecord {
  return {
    id, siteId, siteName: siteId, platform: 'newapi', baseUrl: 'https://example.com',
    displayName: id, authState: 'unknown', authRefId: null,
  };
}

const ACCOUNTS = [account('a1', 's1'), account('a2', 's1'), account('b1', 's2')];
const FILTERS: LogFilters = {
  siteId: 's1', accountId: 'a1', tokenName: 'key', modelName: '', type: 2,
  startDate: '', endDate: '',
};

describe('logs view filters', () => {
  it('filters accounts by site and clears a cross-site account/key', () => {
    expect(accountsForSite(ACCOUNTS, 's1').map(item => item.id)).toEqual(['a1', 'a2']);
    expect(reconcileFilters(ACCOUNTS, { ...FILTERS, siteId: 's2' })).toMatchObject({
      siteId: 's2', accountId: '', tokenName: '',
    });
  });

  it('keeps only newapi sites', () => {
    const sites: SiteRecord[] = [
      { id: 's1', name: 'A', platform: 'newapi', baseUrl: 'x', routeProfile: 'modern', accountCount: 1, useProxy: false, enabled: true, tags: [] },
      { id: 's2', name: 'B', platform: 'sub2api', baseUrl: 'y', routeProfile: 'modern', accountCount: 1, useProxy: false, enabled: true, tags: [] },
    ];
    expect(logCapableSites(sites).map(site => site.id)).toEqual(['s1']);
  });
});

describe('logs view display helpers', () => {
  it('labels a key with its name and masked value only', () => {
    const key: ApiKeyRecord = {
      id: 2, accountId: 'a1', name: 'production', maskedKey: 'sk-…abcd', remainQuota: 0,
      unlimitedQuota: false, usedQuota: 0, status: 1, createdTime: 0, expiredTime: -1,
      hasPlaintext: false,
    };
    expect(describeKeyOption(key)).toBe('production · sk-…abcd');
  });

  it('maps log types and optional metrics', () => {
    expect(describeLogType(5)).toBe('错误');
    expect(describeTokenUsage(10, 2)).toBe('10 / 2');
    expect(describeTokenUsage()).toBe('—');
    expect(describeDuration(1.5)).toBe('1.5s');
    expect(describeDuration()).toBe('—');
  });

  it('converts local date bounds to inclusive Unix seconds', () => {
    const start = dateToTimestamp('2026-07-20', false);
    const end = dateToTimestamp('2026-07-20', true);
    expect(start).toBeDefined();
    expect(end).toBeDefined();
    expect((end ?? 0) - (start ?? 0)).toBe(86_399);
    expect(dateToTimestamp('', false)).toBeUndefined();
  });
});
