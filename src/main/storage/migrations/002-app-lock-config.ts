import type { Migration } from '../migration';
import type Database from 'better-sqlite3';

export const appLockConfigMigration: Migration = {
  version: 2,
  name: 'app-lock-config',
  up(database: Database.Database): void {
    database.exec(`
      CREATE TABLE IF NOT EXISTS app_lock_config (
        id TEXT PRIMARY KEY,
        password_digest TEXT NOT NULL,
        kdf_salt BLOB NOT NULL,
        kdf_memory_cost INTEGER NOT NULL,
        kdf_time_cost INTEGER NOT NULL,
        kdf_parallelism INTEGER NOT NULL,
        wrapped_dek_ciphertext BLOB NOT NULL,
        wrapped_dek_nonce BLOB NOT NULL,
        encryption_version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  },
};
