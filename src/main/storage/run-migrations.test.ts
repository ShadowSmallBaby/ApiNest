import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runMigrations } from './run-migrations';
import { AccountRepository } from './repositories/account-repository';

describe('runMigrations', () => {
  function createTempDatabase(): { database: Database.Database; cleanup: () => void } {
    const directory = mkdtempSync(join(tmpdir(), 'apinest-storage-'));
    const filePath = join(directory, 'test.db');
    const database = new Database(filePath);

    return {
      database,
      cleanup: () => {
        database.close();
        rmSync(directory, { recursive: true, force: true });
      },
    };
  }

  it('creates schema tables and supports duplicate base_url values', () => {
    const { database, cleanup } = createTempDatabase();

    try {
      runMigrations(database);
      runMigrations(database);

      const repository = new AccountRepository(database);
      const now = new Date().toISOString();

      repository.create({
        id: '11111111-1111-4111-8111-111111111111',
        platform: 'newapi',
        baseUrl: 'https://example.com',
        displayName: 'Account A',
        recordVersion: 1,
        createdAt: now,
        updatedAt: now,
      });

      repository.create({
        id: '22222222-2222-4222-8222-222222222222',
        platform: 'newapi',
        baseUrl: 'https://example.com',
        displayName: 'Account B',
        recordVersion: 1,
        createdAt: now,
        updatedAt: now,
      });

      const rows = repository.list();
      const secretsColumns = database.prepare('PRAGMA table_info(secrets)').all() as Array<{
        name: string;
      }>;
      const authStateColumns = database.prepare('PRAGMA table_info(account_auth_state)').all() as Array<{
        name: string;
      }>;

      expect(rows).toHaveLength(2);
      expect(rows[0].baseUrl).toBe('https://example.com');
      expect(rows[1].baseUrl).toBe('https://example.com');
      expect(secretsColumns.map(column => column.name)).toEqual(
        expect.arrayContaining(['ciphertext', 'nonce', 'encryption_version']),
      );
      expect(secretsColumns.map(column => column.name)).not.toEqual(
        expect.arrayContaining(['token', 'cookie', 'api_key']),
      );
      // 迁移 007：站内用户 ID 认证元数据列。
      expect(authStateColumns.map(column => column.name)).toEqual(
        expect.arrayContaining(['site_user_id', 'identity_captured_at']),
      );
    } finally {
      cleanup();
    }
  });
});
