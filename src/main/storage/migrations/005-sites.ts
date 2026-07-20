import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Migration } from '../migration';

interface LegacyAccountRow {
  id: string;
  platform: string;
  baseUrl: string;
  displayName: string;
  linuxDoClientId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 迁移 005：把站点配置从 accounts 提升为独立 Site 实体。
 *
 * 保留 accounts 上的历史站点列作为兼容写入列，避免重建被多个表外键引用的
 * accounts 父表；运行期以 accounts JOIN sites 的结果作为唯一站点配置来源。
 * 每个历史账户各迁移为一个 Site，确保升级不意外合并既有独立账户。
 */
export const sitesMigration: Migration = {
  version: 5,
  name: 'sites',
  up(database: Database.Database): void {
    database.exec(`
      CREATE TABLE IF NOT EXISTS sites (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        platform TEXT NOT NULL,
        base_url TEXT NOT NULL,
        note TEXT,
        linuxdo_client_id TEXT,
        route_profile TEXT NOT NULL DEFAULT 'modern',
        record_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sites_base_url ON sites(base_url);
    `);

    const accountColumns = database.prepare('PRAGMA table_info(accounts)').all() as Array<{
      name: string;
    }>;
    if (!accountColumns.some(column => column.name === 'site_id')) {
      database.exec(`
        ALTER TABLE accounts ADD COLUMN site_id TEXT
          REFERENCES sites(id) ON DELETE CASCADE;
      `);
    }

    const legacyAccounts = database
      .prepare(
        `SELECT
          id,
          platform,
          base_url AS baseUrl,
          display_name AS displayName,
          linuxdo_client_id AS linuxDoClientId,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM accounts
        WHERE site_id IS NULL
        ORDER BY created_at ASC, id ASC`,
      )
      .all() as LegacyAccountRow[];

    const insertSite = database.prepare(
      `INSERT INTO sites (
        id, name, platform, base_url, note, linuxdo_client_id, route_profile,
        record_version, created_at, updated_at
      ) VALUES (
        @id, @name, @platform, @baseUrl, NULL, @linuxDoClientId, @routeProfile,
        1, @createdAt, @updatedAt
      )`,
    );
    const linkAccount = database.prepare(
      'UPDATE accounts SET site_id = @siteId WHERE id = @accountId',
    );
    for (const account of legacyAccounts) {
      const siteId = randomUUID();
      insertSite.run({
        id: siteId,
        name: account.displayName,
        platform: account.platform,
        baseUrl: account.baseUrl,
        linuxDoClientId: account.linuxDoClientId,
        routeProfile: account.platform === 'newapi' ? 'legacy-panel' : 'modern',
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
      });
      linkAccount.run({ siteId, accountId: account.id });
    }

    database.exec(`
      CREATE INDEX IF NOT EXISTS idx_accounts_site_id ON accounts(site_id);

      CREATE TRIGGER IF NOT EXISTS accounts_require_site_id_on_insert
      BEFORE INSERT ON accounts
      WHEN NEW.site_id IS NULL
      BEGIN
        SELECT RAISE(ABORT, 'accounts.site_id is required');
      END;

      CREATE TRIGGER IF NOT EXISTS accounts_require_site_id_on_update
      BEFORE UPDATE OF site_id ON accounts
      WHEN NEW.site_id IS NULL
      BEGIN
        SELECT RAISE(ABORT, 'accounts.site_id is required');
      END;
    `);
  },
};
