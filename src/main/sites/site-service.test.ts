import { describe, expect, it } from 'vitest';
import { SiteService } from './site-service';

const authId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

interface HarnessOptions {
  balanceBySite?: Map<string, { total: number; count: number }>;
  checkedInBySite?: Map<string, number>;
}

function createHarness(options: HarnessOptions = {}) {
  const sites = new Map<string, any>();
  const accounts = new Map<string, any>();
  const cleared: string[] = [];
  const detectedBaseUrls: string[] = [];
  const service = new SiteService({
    siteRepository: {
      create: entity => { sites.set(entity.id, entity); },
      list: () => Array.from(sites.values()),
      get: id => sites.get(id) ?? null,
      update: entity => { sites.set(entity.id, entity); },
      delete: id => { sites.delete(id); for (const [accountId, account] of accounts) if (account.siteId === id) accounts.delete(accountId); },
      transaction: operation => operation(),
    },
    accountRepository: {
      create: entity => {
        if (!('siteId' in entity)) throw new Error('SiteService must create a site-bound account.');
        const site = sites.get(entity.siteId);
        accounts.set(entity.id, { ...entity, siteName: site.name, platform: site.platform, baseUrl: site.baseUrl, linuxDoClientId: site.linuxDoClientId, routeProfile: site.routeProfile });
      },
      get: id => accounts.get(id) ?? null,
      listBySite: siteId => Array.from(accounts.values()).filter((account: any) => account.siteId === siteId),
    },
    authIdentityRepository: { get: id => id === authId ? { id, kind: 'password', label: '共享 auth', useProxy: false, createdAt: '', updatedAt: '' } : null },
    platformDetector: {
      detect: async baseUrl => {
        detectedBaseUrls.push(baseUrl);
        return { platform: 'newapi', confidence: 'high', reason: 'NewAPI marker found.' };
      },
    },
    sessionCleaner: { clearAccountSession: async id => { cleared.push(id); } },
    snapshotRepository: { sumBalanceBySite: () => options.balanceBySite ?? new Map() },
    checkInResultRepository: { countCheckedInTodayBySite: () => options.checkedInBySite ?? new Map() },
  });
  return { service, sites, accounts, cleared, detectedBaseUrls };
}

describe('SiteService', () => {
  it('normalizes the URL before delegating platform detection', async () => {
    const { service, detectedBaseUrls } = createHarness();

    await expect(service.detectPlatform('HTTPS://Example.COM')).resolves.toEqual({
      platform: 'newapi',
      confidence: 'high',
      reason: 'NewAPI marker found.',
    });
    expect(detectedBaseUrls).toEqual(['https://example.com']);
  });

  it('creates one site and its first isolated account atomically', () => {
    const { service, sites, accounts } = createHarness();
    const result = service.create({
      name: '主站', platform: 'newapi', baseUrl: 'HTTPS://Example.COM', routeProfile: 'modern',
      firstAccount: { displayName: '账号 A', authId },
    });
    expect(result.site).toMatchObject({ name: '主站', baseUrl: 'https://example.com', routeProfile: 'modern', accountCount: 1 });
    expect(result.account).toMatchObject({ siteId: result.site.id, siteName: '主站', authRefId: authId });
    expect(sites).toHaveLength(1);
    expect(accounts).toHaveLength(1);
  });

  it('forces a modern route profile for non-NewAPI sites', () => {
    const { service } = createHarness();
    const result = service.create({
      name: 'Sub2API',
      platform: 'sub2api',
      baseUrl: 'https://sub2api.example.com',
      routeProfile: 'legacy-panel',
      firstAccount: { displayName: '账号 A' },
    });

    expect(result.site.routeProfile).toBe('modern');
  });

  it('rejects missing auth identities when creating or adding a site account', () => {
    const { service } = createHarness();
    const missingAuthId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    expect(() => service.create({
      name: '主站', platform: 'newapi', baseUrl: 'https://example.com', routeProfile: 'modern',
      firstAccount: { displayName: '账号 A', authId: missingAuthId },
    })).toThrow('Auth identity was not found.');

    const created = service.create({
      name: '主站', platform: 'newapi', baseUrl: 'https://example.com', routeProfile: 'modern',
      firstAccount: { displayName: '账号 A' },
    });
    expect(() => service.addAccount(created.site.id, { displayName: '账号 B', authId: missingAuthId }))
      .toThrow('Auth identity was not found.');
  });

  it('allows one auth identity to be reused by accounts in multiple sites', () => {
    const { service } = createHarness();
    const first = service.create({ name: 'A', platform: 'newapi', baseUrl: 'https://a.example.com', routeProfile: 'modern', firstAccount: { displayName: 'A1', authId } });
    const second = service.create({ name: 'B', platform: 'newapi', baseUrl: 'https://b.example.com', routeProfile: 'modern', firstAccount: { displayName: 'B1', authId } });
    expect(first.account.authRefId).toBe(authId);
    expect(second.account.authRefId).toBe(authId);
    expect(first.account.siteId).not.toBe(second.account.siteId);
  });

  it('clears every site account session before deleting only that site', async () => {
    const { service, accounts, cleared, sites } = createHarness();
    const created = service.create({ name: 'A', platform: 'newapi', baseUrl: 'https://a.example.com', routeProfile: 'modern', firstAccount: { displayName: 'A1' } });
    service.addAccount(created.site.id, { displayName: 'A2' });
    const other = service.create({ name: 'B', platform: 'newapi', baseUrl: 'https://b.example.com', routeProfile: 'modern', firstAccount: { displayName: 'B1' } });

    await service.remove(created.site.id);

    expect(cleared).toHaveLength(2);
    expect(Array.from(accounts.values()).every((account: any) => account.siteId === other.site.id)).toBe(true);
    expect(sites.has(other.site.id)).toBe(true);
  });

  it('aggregates balance totals and today check-in counts per site', () => {
    const balanceBySite = new Map([['known', { total: 1234, count: 2 }]]);
    const checkedInBySite = new Map([['known', 2]]);
    const { service, sites } = createHarness({ balanceBySite, checkedInBySite });
    // 直接种入两个站点：一个有聚合、一个无聚合，验证 null 与 0 的边界。
    sites.set('known', { id: 'known', name: '有余额站', platform: 'newapi', baseUrl: 'https://known.example.com', routeProfile: 'modern', useProxy: false, enabled: true, tags: [], recordVersion: 1, createdAt: '', updatedAt: '' });
    sites.set('empty', { id: 'empty', name: '无余额站', platform: 'newapi', baseUrl: 'https://empty.example.com', routeProfile: 'modern', useProxy: false, enabled: true, tags: [], recordVersion: 1, createdAt: '', updatedAt: '' });

    const summaries = service.getSummaries();

    expect(summaries).toContainEqual({ siteId: 'known', balanceTotal: 1234, checkedInToday: 2 });
    // 无 balance 快照的站点：balanceTotal 为 null（红线：不伪造 0），checkedInToday 为 0。
    expect(summaries).toContainEqual({ siteId: 'empty', balanceTotal: null, checkedInToday: 0 });
  });

  it('never fabricates a zero balance when the aggregate count is zero', () => {
    // count=0 表示该站点没有任何可解析的 balance 快照，total 必须降级为 null。
    const balanceBySite = new Map([['s', { total: 0, count: 0 }]]);
    const { service, sites } = createHarness({ balanceBySite });
    sites.set('s', { id: 's', name: 'S', platform: 'newapi', baseUrl: 'https://s.example.com', routeProfile: 'modern', useProxy: false, enabled: true, tags: [], recordVersion: 1, createdAt: '', updatedAt: '' });

    expect(service.getSummaries()).toContainEqual({ siteId: 's', balanceTotal: null, checkedInToday: 0 });
  });

  it('returns the normalized site base url for opening the website', () => {
    const { service } = createHarness();
    const created = service.create({ name: 'A', platform: 'newapi', baseUrl: 'https://a.example.com', routeProfile: 'modern', firstAccount: { displayName: 'A1' } });
    expect(service.openWebsiteUrl(created.site.id)).toBe('https://a.example.com');
    expect(() => service.openWebsiteUrl('00000000-0000-4000-8000-000000000000')).toThrow('Site was not found.');
  });
});
