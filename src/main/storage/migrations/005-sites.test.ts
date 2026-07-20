import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runMigrations } from '../run-migrations';

function createVersion4Database(database: Database.Database): void {
  database.exec(`
    CREATE TABLE schema_meta (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TABLE auth_identities (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, label TEXT NOT NULL, note TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, platform TEXT NOT NULL, base_url TEXT NOT NULL,
      display_name TEXT NOT NULL, note TEXT, linuxdo_client_id TEXT,
      record_version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      auth_ref_id TEXT REFERENCES auth_identities(id) ON DELETE SET NULL
    );
    CREATE TABLE account_auth_state (
      account_id TEXT PRIMARY KEY, state TEXT NOT NULL, last_verified_at TEXT,
      last_error_code TEXT, last_error_summary TEXT,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );
    CREATE TABLE account_capabilities (
      account_id TEXT PRIMARY KEY, adapter_version TEXT NOT NULL,
      capabilities_json TEXT NOT NULL, checked_at TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );
    CREATE TABLE account_snapshots (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, kind TEXT NOT NULL,
      payload_json TEXT NOT NULL, semantic_unit TEXT, fetched_at TEXT NOT NULL,
      is_latest INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );
    CREATE TABLE operations (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, kind TEXT NOT NULL,
      status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
      error_code TEXT, error_summary TEXT, details_json TEXT,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );
    CREATE TABLE checkin_results (
      operation_id TEXT NOT NULL, account_id TEXT NOT NULL, result TEXT NOT NULL,
      message TEXT, checked_at TEXT NOT NULL, PRIMARY KEY (operation_id, account_id),
      FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE CASCADE,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );
    CREATE TABLE secrets (
      secret_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, purpose TEXT NOT NULL,
      ciphertext BLOB NOT NULL, nonce BLOB NOT NULL, encryption_version INTEGER NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE app_lock_config (
      id INTEGER PRIMARY KEY CHECK (id = 1), password_digest BLOB NOT NULL,
      kdf_salt BLOB NOT NULL, kdf_memory_cost INTEGER NOT NULL,
      kdf_time_cost INTEGER NOT NULL, kdf_parallelism INTEGER NOT NULL,
      wrapped_dek_ciphertext BLOB NOT NULL, wrapped_dek_nonce BLOB NOT NULL,
      encryption_version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    INSERT INTO schema_meta (version, applied_at) VALUES
      (1, '2026-01-01T00:00:00.000Z'), (2, '2026-01-01T00:00:00.000Z'),
      (3, '2026-01-01T00:00:00.000Z'), (4, '2026-01-01T00:00:00.000Z');
  `);
}

describe('migration 005 sites', () => {
  it('creates one site per legacy account while preserving account identities and references', () => {
    const directory = mkdtempSync(join(tmpdir(), 'apinest-sites-migration-'));
    const database = new Database(join(directory, 'test.db'));
    database.pragma('foreign_keys = ON');

    try {
      createVersion4Database(database);
      const now = '2026-07-17T00:00:00.000Z';
      database.prepare(
        `INSERT INTO auth_identities (id, kind, label, created_at, updated_at)
         VALUES (?, 'password', '共享 auth', ?, ?)`,
      ).run('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', now, now);

      const insertAccount = database.prepare(
        `INSERT INTO accounts (
          id, platform, base_url, display_name, note, linuxdo_client_id,
          record_version, created_at, updated_at, auth_ref_id
        ) VALUES (?, 'newapi', 'https://same.example.com/', ?, ?, ?, 1, ?, ?, ?)`,
      );
      insertAccount.run(
        '11111111-1111-4111-8111-111111111111', '账号 A', '备注 A', 'client-a', now, now,
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      );
      insertAccount.run(
        '22222222-2222-4222-8222-222222222222', '账号 B', '备注 B', 'client-a', now, now, null,
      );
      insertAccount.run(
        '33333333-3333-4333-8333-333333333333', '账号 C', '备注 C', 'client-b', now, now, null,
      );
      database.prepare(
        `INSERT INTO account_auth_state (account_id, state) VALUES (?, 'active')`,
      ).run('11111111-1111-4111-8111-111111111111');

      runMigrations(database);
      runMigrations(database);

      const sites = database.prepare('SELECT * FROM sites ORDER BY created_at, id').all() as Array<Record<string, unknown>>;
      const accounts = database
        .prepare('SELECT id, site_id AS siteId, display_name AS displayName, note, auth_ref_id AS authRefId FROM accounts ORDER BY id')
        .all() as Array<{
          id: string;
          siteId: string;
          displayName: string;
          note: string | null;
          authRefId: string | null;
        }>;
      const state = database.prepare('SELECT * FROM account_auth_state').get() as Record<string, unknown>;
      const foreignKeyErrors = database.prepare('PRAGMA foreign_key_check').all();

      expect(sites).toHaveLength(3);
      expect(sites.every(site => site.route_profile === 'legacy-panel')).toBe(true);
      expect(accounts[0]).toMatchObject({
        id: '11111111-1111-4111-8111-111111111111',
        displayName: '账号 A',
        note: '备注 A',
        authRefId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      });
      expect(new Set(accounts.map(account => account.siteId)).size).toBe(3);
      expect(accounts[0].siteId).not.toBe(accounts[1].siteId);
      expect(accounts[2].siteId).not.toBe(accounts[0].siteId);
      expect(state).toMatchObject({ account_id: '11111111-1111-4111-8111-111111111111', state: 'active' });
      expect(database.prepare('SELECT COUNT(*) AS count FROM schema_meta WHERE version = 5').get()).toEqual({ count: 1 });
      expect(() => database.prepare(
        `INSERT INTO accounts (
          id, platform, base_url, display_name, record_version, created_at, updated_at
        ) VALUES (?, 'newapi', 'https://new.example.com/', '无站点账号', 1, ?, ?)`,
      ).run('44444444-4444-4444-8444-444444444444', now, now)).toThrow(
        'accounts.site_id is required',
      );
      expect(() => database.prepare('UPDATE accounts SET site_id = NULL WHERE id = ?').run(
        '11111111-1111-4111-8111-111111111111',
      )).toThrow('accounts.site_id is required');

      database.prepare('DELETE FROM sites WHERE id = ?').run(accounts[0].siteId);
      expect(database.prepare('SELECT id FROM accounts WHERE id = ?').get(accounts[0].id)).toBeUndefined();
      expect(database.prepare('SELECT account_id FROM account_auth_state').get()).toBeUndefined();
      expect(database.prepare('SELECT COUNT(*) AS count FROM accounts').get()).toEqual({ count: 2 });
      expect(foreignKeyErrors).toEqual([]);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
