import { describe, expect, it } from 'vitest';
import { getAccountPartition } from '../src/main/auth/account-partition';
import { SiteService } from '../src/main/sites/site-service';

const authId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function createSiteHarness() {
  const sites = new Map<string, any>();
  const accounts = new Map<string, any>();
  const cleared: string[] = [];
  const service = new SiteService({
    siteRepository: {
      create: entity => {
        sites.set(entity.id, entity);
      },
      list: () => Array.from(sites.values()),
      get: id => sites.get(id) ?? null,
      update: entity => {
        sites.set(entity.id, entity);
      },
      delete: id => {
        sites.delete(id);
        for (const [accountId, account] of accounts) {
          if (account.siteId === id) accounts.delete(accountId);
        }
      },
      transaction: operation => operation(),
    },
    accountRepository: {
      create: entity => {
        if (!('siteId' in entity)) {
          throw new Error('SiteService must create a site-bound account.');
        }
        const site = sites.get(entity.siteId);
        accounts.set(entity.id, {
          ...entity,
          siteName: site.name,
          platform: site.platform,
          baseUrl: site.baseUrl,
          linuxDoClientId: site.linuxDoClientId,
          routeProfile: site.routeProfile,
        });
      },
      get: id => accounts.get(id) ?? null,
      listBySite: siteId => Array.from(accounts.values()).filter((account: any) => account.siteId === siteId),
    },
    authIdentityRepository: {
      get: id => (id === authId
        ? { id, kind: 'password', label: '共享 auth', createdAt: '', updatedAt: '' }
        : null),
    },
    platformDetector: {
      detect: async () => ({ platform: 'newapi', confidence: 'unknown', reason: 'unused' }),
    },
    sessionCleaner: {
      clearAccountSession: async id => {
        cleared.push(id);
      },
    },
  });

  return { service, sites, accounts, cleared };
}

describe('Site → Account 隔离与安全边界', () => {
  it('keeps accounts, partitions and auth refs isolated across sites', async () => {
    const { service, accounts, cleared, sites } = createSiteHarness();

    const siteA = service.create({
      name: '站点 A',
      platform: 'newapi',
      baseUrl: 'https://a.example.com',
      routeProfile: 'modern',
      firstAccount: { displayName: 'A1', authId },
    });
    const siteB = service.create({
      name: '站点 B',
      platform: 'newapi',
      baseUrl: 'https://b.example.com',
      routeProfile: 'classic',
      firstAccount: { displayName: 'B1', authId },
    });
    const siteASecond = service.addAccount(siteA.site.id, { displayName: 'A2' });

    const accountsA = Array.from(accounts.values()).filter((account: any) => account.siteId === siteA.site.id);
    const accountsB = Array.from(accounts.values()).filter((account: any) => account.siteId === siteB.site.id);

    expect(accountsA.map((account: any) => account.displayName).sort()).toEqual(['A1', 'A2']);
    expect(accountsB.map((account: any) => account.displayName)).toEqual(['B1']);
    expect(siteA.account.authRefId).toBe(authId);
    expect(siteB.account.authRefId).toBe(authId);
    expect(JSON.stringify(siteA.account)).not.toMatch(/password|username|secret/i);
    expect(JSON.stringify(siteB.account)).not.toMatch(/password|username|secret/i);

    const partitionA1 = getAccountPartition(siteA.account.id);
    const partitionA2 = getAccountPartition(siteASecond.id);
    const partitionB1 = getAccountPartition(siteB.account.id);
    expect(partitionA1).toBe(`persist:apinest-account-${siteA.account.id}`);
    expect(partitionA2).toBe(`persist:apinest-account-${siteASecond.id}`);
    expect(partitionB1).toBe(`persist:apinest-account-${siteB.account.id}`);
    expect(new Set([partitionA1, partitionA2, partitionB1]).size).toBe(3);

    await service.remove(siteA.site.id);

    expect(cleared.sort()).toEqual([siteA.account.id, siteASecond.id].sort());
    expect(sites.has(siteA.site.id)).toBe(false);
    expect(sites.has(siteB.site.id)).toBe(true);
    expect(Array.from(accounts.values()).every((account: any) => account.siteId === siteB.site.id)).toBe(true);
    expect(getAccountPartition(siteB.account.id)).toBe(partitionB1);
  });
});
