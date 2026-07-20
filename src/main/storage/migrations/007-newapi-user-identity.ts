import type Database from 'better-sqlite3';
import type { Migration } from '../migration';

/**
 * 迁移 007：为 account_auth_state 增补 NewAPI 站内数字用户 ID 元数据。
 *
 * NewAPI 上游 `UserAuth()` 强制要求请求头 `New-Api-User`（站内数字用户 ID），
 * 仅账户 partition Cookie 不足以通过认证。该 ID 只能在登录窗口页面 localStorage
 * 捕获，故作为「认证元数据」（非凭据）持久化于此，绝不进入 Vault/secrets。
 *
 * 幂等：以 PRAGMA 检查列是否已存在，避免重复 ALTER 失败；不回填任何猜测值，
 * 既有账户 site_user_id 保持 NULL，待下次应用内登录时惰性补全。
 */
export const newApiUserIdentityMigration: Migration = {
  version: 7,
  name: 'newapi-user-identity',
  up(database: Database.Database): void {
    // account_auth_state 由迁移 001 建；异常/不完整库中缺失时跳过，避免破坏迁移链
    // （正常升级链一定已建该表，此处仅为防御，与 006 的列级 PRAGMA 检查同理）。
    const tableExists = database
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='account_auth_state'")
      .get();
    if (!tableExists) {
      return;
    }

    const columns = database.prepare('PRAGMA table_info(account_auth_state)').all() as Array<{
      name: string;
    }>;
    const columnNames = new Set(columns.map(column => column.name));

    if (!columnNames.has('site_user_id')) {
      database.exec('ALTER TABLE account_auth_state ADD COLUMN site_user_id TEXT;');
    }
    if (!columnNames.has('identity_captured_at')) {
      database.exec('ALTER TABLE account_auth_state ADD COLUMN identity_captured_at TEXT;');
    }
  },
};
