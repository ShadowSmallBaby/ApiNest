import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runMigrations } from '../run-migrations';

const SITE_ID = 'ssssssss-ssss-4sss-8sss-ssssssssssss';
const ACCOUNT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOW = '2026-07-24T00:00:00.000Z';

/**
 * 建一个已迁移到最新 schema 的库，并插入一个站点 + 账号，
 * 供 account_keys 的外键与级联删除断言使用。
 */
function seedDatabase(database: Database.Database): void {
  runMigrations(database);
  database
    .prepare(
      `INSERT INTO sites (
        id, name, platform, base_url, route_profile, record_version, created_at, updated_at
      ) VALUES (?, '站点', 'newapi', 'https://api.example.com/', 'modern', 1, ?, ?)`,
    )
    .run(SITE_ID, NOW, NOW);
  database
    .prepare(
      `INSERT INTO accounts (
        id, platform, base_url, display_name, site_id, record_version, created_at, updated_at
      ) VALUES (?, 'newapi', 'https://api.example.com/', '账号', ?, 1, ?, ?)`,
    )
    .run(ACCOUNT_ID, SITE_ID, NOW, NOW);
}

function insertKey(database: Database.Database, tokenId: number, name: string): void {
  database
    .prepare(
      `INSERT INTO account_keys (
        token_id, site_id, account_id, name, masked_key, updated_at
      ) VALUES (?, ?, ?, ?, 'sk-…abcd', ?)`,
    )
    .run(tokenId, SITE_ID, ACCOUNT_ID, name, NOW);
}

describe('migration 009 account_keys', () => {
  it('creates the table, enforces (token_id, site_id) uniqueness, and cascades on delete', () => {
    const directory = mkdtempSync(join(tmpdir(), 'apinest-account-keys-migration-'));
    const database = new Database(join(directory, 'test.db'));
    database.pragma('foreign_keys = ON');

    try {
      seedDatabase(database);
      // 幂等：重复迁移不报错。
      runMigrations(database);

      expect(database.prepare('SELECT COUNT(*) AS count FROM schema_meta WHERE version = 9').get()).toEqual({
        count: 1,
      });

      insertKey(database, 1, '密钥一');

      // 同 (token_id, site_id) 违反主键。
      expect(() => insertKey(database, 1, '重复')).toThrow();

      // 站点删除级联清理本地密钥。
      database.prepare('DELETE FROM sites WHERE id = ?').run(SITE_ID);
      expect(database.prepare('SELECT COUNT(*) AS count FROM account_keys').get()).toEqual({ count: 0 });
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('cascades on account delete as well', () => {
    const directory = mkdtempSync(join(tmpdir(), 'apinest-account-keys-cascade-'));
    const database = new Database(join(directory, 'test.db'));
    database.pragma('foreign_keys = ON');

    try {
      seedDatabase(database);
      insertKey(database, 7, '密钥七');

      database.prepare('DELETE FROM accounts WHERE id = ?').run(ACCOUNT_ID);
      expect(database.prepare('SELECT COUNT(*) AS count FROM account_keys').get()).toEqual({ count: 0 });
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
