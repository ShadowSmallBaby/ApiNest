import type Database from 'better-sqlite3';
import type { Migration } from '../migration';

/**
 * 迁移 009：本地密钥表（NewAPI token 持久化）。
 *
 * 远程密钥列表拉回后展开为逐条记录持久化到本地，避免频繁联网拉取。
 * 唯一键为 (token_id, site_id)：NewAPI token id 在站内全局自增稳定，
 * 同站点内不碰撞；account_id 作附加引用用于「站点·账号」展示与刷新范围。
 *
 * 安全红线：
 * - 本表只存**非敏感元数据**（脱敏 key、额度、状态、时间）；
 * - 完整明文 key 绝不入本表——明文走 Vault secrets 表信封加密
 *   （purpose='newapi_token_key'），本表仅以 plaintext_secret_id 记录引用与
 *   captured_at 记录入库时间，标记「明文是否已惰性获取入库」；
 * - site_id / account_id 均 ON DELETE CASCADE，账户或站点删除时本地密钥自动清理。
 */
export const accountKeysMigration: Migration = {
  version: 9,
  name: 'account-keys',
  up(database: Database.Database): void {
    database.exec(`
      CREATE TABLE IF NOT EXISTS account_keys (
        token_id            INTEGER NOT NULL,
        site_id             TEXT NOT NULL,
        account_id          TEXT NOT NULL,
        name                TEXT NOT NULL DEFAULT '',
        masked_key          TEXT NOT NULL DEFAULT '',
        group_name          TEXT,
        remain_quota        REAL NOT NULL DEFAULT 0,
        unlimited_quota     INTEGER NOT NULL DEFAULT 0 CHECK (unlimited_quota IN (0, 1)),
        used_quota          REAL NOT NULL DEFAULT 0,
        status              INTEGER NOT NULL DEFAULT 0,
        created_time        INTEGER NOT NULL DEFAULT 0,
        expired_time        INTEGER NOT NULL DEFAULT -1,
        plaintext_secret_id TEXT,
        captured_at         TEXT,
        updated_at          TEXT NOT NULL,
        PRIMARY KEY (token_id, site_id),
        FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_account_keys_account_id ON account_keys(account_id);
    `);
  },
};
