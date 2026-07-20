import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '../run-migrations';
import { AccountRepository } from './account-repository';
import { SiteRepository, type SiteEntity } from './site-repository';

const AUTH_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SITE_A_ID = '11111111-1111-4111-8111-111111111111';
const SITE_B_ID = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_A_ID = '33333333-3333-4333-8333-333333333333';
const ACCOUNT_B_ID = '44444444-4444-4444-8444-444444444444';
const NOW = '2026-07-17T00:00:00.000Z';

function createSite(id: string, overrides: Partial<SiteEntity> = {}): SiteEntity {
  return {
    id,
    name: `Site ${id === SITE_A_ID ? 'A' : 'B'}`,
    platform: 'newapi',
    baseUrl: id === SITE_A_ID ? 'https://a.example.com/' : 'https://b.example.com/',
    routeProfile: 'modern',
    useProxy: false,
    recordVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('SiteRepository 与 AccountRepository', () => {
  function createHarness(): {
    database: Database.Database;
    siteRepository: SiteRepository;
    accountRepository: AccountRepository;
    cleanup: () => void;
  } {
    const directory = mkdtempSync(join(tmpdir(), 'apinest-site-repositories-'));
    const database = new Database(join(directory, 'test.db'));
    database.pragma('foreign_keys = ON');
    runMigrations(database);

    return {
      database,
      siteRepository: new SiteRepository(database),
      accountRepository: new AccountRepository(database),
      cleanup: () => {
        database.close();
        rmSync(directory, { recursive: true, force: true });
      },
    };
  }

  it('creates, updates, lists and deletes sites', () => {
    const { siteRepository, cleanup } = createHarness();

    try {
      const site = createSite(SITE_A_ID, { note: '初始备注' });
      siteRepository.create(site);

      expect(siteRepository.get(site.id)).toEqual(site);
      expect(siteRepository.list()).toEqual([site]);

      const updated = {
        ...site,
        name: '更新后的站点',
        note: undefined,
        routeProfile: 'classic' as const,
        recordVersion: 2,
        updatedAt: '2026-07-17T01:00:00.000Z',
      };
      siteRepository.update(updated);
      expect(siteRepository.get(site.id)).toEqual(updated);

      siteRepository.delete(site.id);
      expect(siteRepository.get(site.id)).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('reads site configuration through the account join and filters by site', () => {
    const { siteRepository, accountRepository, cleanup } = createHarness();

    try {
      const siteA = createSite(SITE_A_ID);
      const siteB = createSite(SITE_B_ID);
      siteRepository.create(siteA);
      siteRepository.create(siteB);
      accountRepository.create({
        id: ACCOUNT_A_ID,
        siteId: siteA.id,
        displayName: '账号 A',
        recordVersion: 1,
        createdAt: NOW,
        updatedAt: NOW,
      });
      accountRepository.create({
        id: ACCOUNT_B_ID,
        siteId: siteB.id,
        displayName: '账号 B',
        recordVersion: 1,
        createdAt: NOW,
        updatedAt: NOW,
      });

      const updatedSiteA = {
        ...siteA,
        name: '站点 A 新名称',
        baseUrl: 'https://a-new.example.com/',
        routeProfile: 'classic' as const,
        recordVersion: 2,
      };
      siteRepository.update(updatedSiteA);

      expect(accountRepository.listBySite(siteA.id)).toEqual([
        expect.objectContaining({
          id: ACCOUNT_A_ID,
          siteId: siteA.id,
          siteName: updatedSiteA.name,
          baseUrl: updatedSiteA.baseUrl,
          routeProfile: updatedSiteA.routeProfile,
        }),
      ]);
      expect(accountRepository.listBySite(siteB.id).map(account => account.id)).toEqual([
        ACCOUNT_B_ID,
      ]);
      expect(accountRepository.list()).toHaveLength(2);
    } finally {
      cleanup();
    }
  });

  it('rejects an account bound to an unknown site', () => {
    const { accountRepository, cleanup } = createHarness();

    try {
      expect(() => accountRepository.create({
        id: ACCOUNT_A_ID,
        siteId: SITE_A_ID,
        displayName: '孤立账号',
        recordVersion: 1,
        createdAt: NOW,
        updatedAt: NOW,
      })).toThrow('Site was not found while creating account.');
      expect(accountRepository.list()).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it('allows one auth identity to be referenced by accounts in different sites', () => {
    const { database, siteRepository, accountRepository, cleanup } = createHarness();

    try {
      database.prepare(
        `INSERT INTO auth_identities (id, kind, label, created_at, updated_at)
         VALUES (?, 'password', '共享 auth', ?, ?)`,
      ).run(AUTH_ID, NOW, NOW);
      const siteA = createSite(SITE_A_ID);
      const siteB = createSite(SITE_B_ID);
      siteRepository.create(siteA);
      siteRepository.create(siteB);

      for (const [id, siteId, displayName] of [
        [ACCOUNT_A_ID, siteA.id, '账号 A'],
        [ACCOUNT_B_ID, siteB.id, '账号 B'],
      ] as const) {
        accountRepository.create({
          id,
          siteId,
          displayName,
          authRefId: AUTH_ID,
          recordVersion: 1,
          createdAt: NOW,
          updatedAt: NOW,
        });
      }

      expect(accountRepository.list().map(account => account.authRefId)).toEqual([
        AUTH_ID,
        AUTH_ID,
      ]);
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      cleanup();
    }
  });
});
