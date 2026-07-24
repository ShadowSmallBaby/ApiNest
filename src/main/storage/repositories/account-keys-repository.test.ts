import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runMigrations } from '../run-migrations';
import { AccountKeysRepository, type AccountKeyMetadata } from './account-keys-repository';

const SITE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-07-24T00:00:00.000Z';

function setupDatabase(): { database: Database.Database; directory: string } {
  const directory = mkdtempSync(join(tmpdir(), 'apinest-account-keys-'));
  const database = new Database(join(directory, 'test.db'));
  database.pragma('foreign_keys = ON');
  runMigrations(database);

  database
    .prepare(
      `INSERT INTO sites (id, name, platform, base_url, route_profile, record_version, created_at, updated_at)
       VALUES (?, 'Site', 'newapi', 'https://api.example.com', 'modern', 1, ?, ?)`,
    )
    .run(SITE_ID, NOW, NOW);
  database
    .prepare(
      `INSERT INTO accounts (id, platform, base_url, display_name, site_id, record_version, created_at, updated_at)
       VALUES (?, 'newapi', 'https://api.example.com', 'acct', ?, 1, ?, ?)`,
    )
    .run(ACCOUNT_ID, SITE_ID, NOW, NOW);

  return { database, directory };
}

function metadata(tokenId: number, overrides: Partial<AccountKeyMetadata> = {}): AccountKeyMetadata {
  return {
    tokenId,
    name: `token-${tokenId}`,
    maskedKey: 'sk-…abcd',
    group: 'default',
    remainQuota: 100,
    unlimitedQuota: false,
    usedQuota: 10,
    status: 1,
    createdTime: 1000 + tokenId,
    expiredTime: -1,
    ...overrides,
  };
}

describe('AccountKeysRepository', () => {
  it('inserts, lists (ordered) and reads a single row', () => {
    const { database, directory } = setupDatabase();
    try {
      const repository = new AccountKeysRepository(database);
      repository.replaceAccountMetadata({
        accountId: ACCOUNT_ID,
        siteId: SITE_ID,
        records: [metadata(2, { createdTime: 2000 }), metadata(1, { createdTime: 1000 })],
        updatedAt: NOW,
      });

      const list = repository.listByAccount(ACCOUNT_ID);
      expect(list.map(row => row.tokenId)).toEqual([1, 2]);
      expect(repository.get(1, SITE_ID)?.name).toBe('token-1');
      expect(repository.get(999, SITE_ID)).toBeNull();
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('overwrites metadata but preserves an already-captured plaintext reference', () => {
    const { database, directory } = setupDatabase();
    try {
      const repository = new AccountKeysRepository(database);
      repository.replaceAccountMetadata({
        accountId: ACCOUNT_ID,
        siteId: SITE_ID,
        records: [metadata(1, { name: 'old', remainQuota: 100 })],
        updatedAt: NOW,
      });
      repository.attachPlaintext(1, SITE_ID, 'secret-1', NOW);

      // 再次 refresh：元数据更新，但明文引用必须保留。
      repository.replaceAccountMetadata({
        accountId: ACCOUNT_ID,
        siteId: SITE_ID,
        records: [metadata(1, { name: 'new', remainQuota: 50 })],
        updatedAt: '2026-07-25T00:00:00.000Z',
      });

      const row = repository.get(1, SITE_ID);
      expect(row?.name).toBe('new');
      expect(row?.remainQuota).toBe(50);
      expect(row?.plaintextSecretId).toBe('secret-1');
      expect(row?.capturedAt).toBe(NOW);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('deletes rows absent from the incoming list and reports their orphan secret ids', () => {
    const { database, directory } = setupDatabase();
    try {
      const repository = new AccountKeysRepository(database);
      repository.replaceAccountMetadata({
        accountId: ACCOUNT_ID,
        siteId: SITE_ID,
        records: [metadata(1), metadata(2)],
        updatedAt: NOW,
      });
      repository.attachPlaintext(2, SITE_ID, 'secret-2', NOW);

      // token 2 在远程被删除：本地行应删除，其明文引用应作为孤儿回传。
      const result = repository.replaceAccountMetadata({
        accountId: ACCOUNT_ID,
        siteId: SITE_ID,
        records: [metadata(1)],
        updatedAt: NOW,
      });

      expect(result.orphanSecretIds).toEqual(['secret-2']);
      expect(repository.listByAccount(ACCOUNT_ID).map(row => row.tokenId)).toEqual([1]);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('cascades on account deletion', () => {
    const { database, directory } = setupDatabase();
    try {
      const repository = new AccountKeysRepository(database);
      repository.replaceAccountMetadata({
        accountId: ACCOUNT_ID,
        siteId: SITE_ID,
        records: [metadata(1)],
        updatedAt: NOW,
      });

      database.prepare('DELETE FROM accounts WHERE id = ?').run(ACCOUNT_ID);
      expect(repository.listByAccount(ACCOUNT_ID)).toEqual([]);
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('deleteByAccount removes rows and returns captured orphan secret ids', () => {
    const { database, directory } = setupDatabase();
    try {
      const repository = new AccountKeysRepository(database);
      repository.replaceAccountMetadata({
        accountId: ACCOUNT_ID,
        siteId: SITE_ID,
        records: [metadata(1), metadata(2)],
        updatedAt: NOW,
      });
      repository.attachPlaintext(1, SITE_ID, 'secret-1', NOW);

      const result = repository.deleteByAccount(ACCOUNT_ID);
      expect(result.orphanSecretIds).toEqual(['secret-1']);
      expect(repository.listByAccount(ACCOUNT_ID)).toEqual([]);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
