import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runMigrations } from '../run-migrations';

/**
 * 迁移 004（auth 身份实体化）验证：
 *  - auth_identities 表与 accounts.auth_ref_id 列被创建；
 *  - 迁移可重复运行（幂等）；
 *  - 现有 site_login_credential 密文零丢失搬运为 password 类型 auth 身份，
 *    并把账户 auth_ref_id 指向新身份、secrets purpose 改为 auth_identity_credential。
 */
describe('migration 004 auth-identities', () => {
  function createTempDatabase(): { database: Database.Database; cleanup: () => void } {
    const directory = mkdtempSync(join(tmpdir(), 'apinest-auth-mig-'));
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

  it('creates auth_identities table and auth_ref_id column, idempotently', () => {
    const { database, cleanup } = createTempDatabase();
    try {
      runMigrations(database);
      runMigrations(database);

      const authTable = database
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='auth_identities'`)
        .get() as { name: string } | undefined;
      expect(authTable?.name).toBe('auth_identities');

      const accountColumns = database.prepare('PRAGMA table_info(accounts)').all() as Array<{ name: string }>;
      expect(accountColumns.map(c => c.name)).toEqual(expect.arrayContaining(['auth_ref_id']));
    } finally {
      cleanup();
    }
  });

  it('migrates legacy site_login_credential into a password auth identity without data loss', () => {
    const { database, cleanup } = createTempDatabase();
    try {
      // 先迁移到版本 3（不含 004），插入一条历史账户 + 站点账密密文。
      // 直接建到 3 之前的 state：用完整 runMigrations 建到最新，然后手工模拟旧数据不便；
      // 改为：runMigrations 建到最新后，验证 004 对既有 site_login_credential 的处理需在 004 之前注入。
      // 因此这里用一个只到版本 3 的库来注入旧数据，再单独跑 004。
      // 简化：直接构造 accounts + secrets 旧数据后调用完整 runMigrations，
      // 但 004 已随 runMigrations 执行 —— 故改为在 004 执行“前”注入。
      // 采用手动建表到 v3 的等价 schema，然后注入，再 runMigrations 补 004。
      database.exec(`
        CREATE TABLE schema_meta (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
        CREATE TABLE accounts (
          id TEXT PRIMARY KEY, platform TEXT NOT NULL, base_url TEXT NOT NULL,
          display_name TEXT NOT NULL, note TEXT, linuxdo_client_id TEXT,
          record_version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE secrets (
          secret_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, purpose TEXT NOT NULL,
          ciphertext BLOB NOT NULL, nonce BLOB NOT NULL, encryption_version INTEGER NOT NULL,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
        );
        INSERT INTO schema_meta (version, applied_at) VALUES (1, '2020-01-01T00:00:00.000Z'),
          (2, '2020-01-01T00:00:00.000Z'), (3, '2020-01-01T00:00:00.000Z');
      `);

      const now = new Date().toISOString();
      database.prepare(
        `INSERT INTO accounts (id, platform, base_url, display_name, record_version, created_at, updated_at)
         VALUES (?, 'newapi', 'https://example.com', 'Account A', 1, ?, ?)`,
      ).run('11111111-1111-4111-8111-111111111111', now, now);

      const cipher = Buffer.from('cipher-bytes');
      const nonce = Buffer.from('nonce-bytes');
      database.prepare(
        `INSERT INTO secrets (secret_id, account_id, purpose, ciphertext, nonce, encryption_version, created_at, updated_at)
         VALUES ('site_login_credential:11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111',
                 'site_login_credential', ?, ?, 1, ?, ?)`,
      ).run(cipher, nonce, now, now);

      // 跑 004（runMigrations 只补未应用的版本 4）。
      runMigrations(database);

      // 新建了一个 password 类型 auth 身份。
      const identities = database.prepare('SELECT * FROM auth_identities').all() as Array<Record<string, unknown>>;
      expect(identities).toHaveLength(1);
      expect(identities[0].kind).toBe('password');
      const authId = String(identities[0].id);

      // 账户 auth_ref_id 指向新身份。
      const account = database
        .prepare('SELECT auth_ref_id FROM accounts WHERE id = ?')
        .get('11111111-1111-4111-8111-111111111111') as { auth_ref_id: string };
      expect(account.auth_ref_id).toBe(authId);

      // 密文零丢失，purpose/secret_id/account_id 改绑 auth 身份。
      const secret = database
        .prepare(`SELECT * FROM secrets WHERE secret_id = ?`)
        .get(`auth_identity_credential:${authId}`) as Record<string, unknown>;
      expect(secret.purpose).toBe('auth_identity_credential');
      expect(secret.account_id).toBe(authId);
      expect(Buffer.from(secret.ciphertext as Buffer).toString()).toBe('cipher-bytes');
    } finally {
      cleanup();
    }
  });
});
