import type { AccountRecord, ModelRecord, SiteRecord } from '../../../../shared/ipc/bridge';
import {
  accountsForSite,
  applyAvailabilityFilter,
  describeEndpoints,
  describeGroups,
  describePricing,
  describeQuotaType,
  modelCapableSites,
  reconcileFilters,
  targetAccounts,
} from './models-view';

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

function model(overrides: Partial<ModelRecord> = {}): ModelRecord {
  return {
    modelName: 'gpt-4o',
    quotaType: 0,
    modelRatio: 2.5,
    completionRatio: 3,
    modelPrice: 0,
    enableGroups: ['default'],
    supportedEndpointTypes: ['chat/completions'],
    availableForAccount: true,
    ...overrides,
  };
}

const ACCOUNTS: AccountRecord[] = [
  account('a1', SITE_A),
  account('a2', SITE_A),
  account('b1', SITE_B),
];

describe('models view account filters', () => {
  it('filters accounts by site and narrows to a selected account', () => {
    expect(accountsForSite(ACCOUNTS, SITE_A).map(item => item.id)).toEqual(['a1', 'a2']);
    expect(targetAccounts(ACCOUNTS, { siteId: SITE_A, accountId: 'a2' }).map(item => item.id)).toEqual(['a2']);
    expect(targetAccounts(ACCOUNTS, { siteId: 'all', accountId: 'all' })).toHaveLength(3);
  });

  it('resets an account that is outside the selected site', () => {
    expect(reconcileFilters(ACCOUNTS, {
      siteId: SITE_A,
      accountId: 'b1',
      availableOnly: true,
    })).toEqual({ siteId: SITE_A, accountId: 'all', availableOnly: true });
  });
});

describe('modelCapableSites', () => {
  it('keeps only newapi sites', () => {
    const sites: SiteRecord[] = [
      { id: SITE_A, name: 'A', platform: 'newapi', baseUrl: 'x', routeProfile: 'modern', accountCount: 1, useProxy: false },
      { id: SITE_B, name: 'B', platform: 'sub2api', baseUrl: 'y', routeProfile: 'modern', accountCount: 1, useProxy: false },
    ];
    expect(modelCapableSites(sites).map(site => site.id)).toEqual([SITE_A]);
  });
});

describe('model availability filter', () => {
  it('filters unavailable models only when requested', () => {
    const models = [model(), model({ modelName: 'disabled', availableForAccount: false })];
    expect(applyAvailabilityFilter(models, false)).toEqual(models);
    expect(applyAvailabilityFilter(models, true).map(item => item.modelName)).toEqual(['gpt-4o']);
  });
});

describe('model display helpers', () => {
  it('describes quota types and pricing', () => {
    expect(describeQuotaType(0)).toBe('按量计费');
    expect(describeQuotaType(1)).toBe('按次计费');
    expect(describePricing(model())).toBe('输入 ×2.5 / 补全 ×3');
    expect(describePricing(model({ quotaType: 1, modelPrice: 0.02 }))).toBe('$0.02 / 次');
  });

  it('describes groups and endpoints with empty fallbacks', () => {
    expect(describeGroups(['default', 'vip'])).toBe('default、vip');
    expect(describeGroups([])).toBe('—');
    expect(describeEndpoints(['chat/completions', 'messages'])).toBe('chat/completions、messages');
    expect(describeEndpoints([])).toBe('—');
  });
});
