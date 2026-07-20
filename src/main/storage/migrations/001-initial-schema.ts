import type Database from 'better-sqlite3';
import type { Migration } from '../migration';

export const initialSchemaMigration: Migration = {
  version: 1,
  name: 'initial-schema',
  up(database: Database.Database): void {
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        base_url TEXT NOT NULL,
        display_name TEXT NOT NULL,
        note TEXT,
        linuxdo_client_id TEXT,
        record_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS account_auth_state (
        account_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        last_verified_at TEXT,
        last_error_code TEXT,
        last_error_summary TEXT,
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS account_capabilities (
        account_id TEXT PRIMARY KEY,
        adapter_version TEXT NOT NULL,
        capabilities_json TEXT NOT NULL,
        checked_at TEXT NOT NULL,
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS account_snapshots (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        semantic_unit TEXT,
        fetched_at TEXT NOT NULL,
        is_latest INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS operations (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        error_code TEXT,
        error_summary TEXT,
        details_json TEXT,
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS checkin_results (
        operation_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        result TEXT NOT NULL,
        message TEXT,
        checked_at TEXT NOT NULL,
        PRIMARY KEY (operation_id, account_id),
        FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE CASCADE,
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS secrets (
        secret_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        purpose TEXT NOT NULL,
        ciphertext BLOB NOT NULL,
        nonce BLOB NOT NULL,
        encryption_version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_accounts_base_url ON accounts(base_url);
      CREATE INDEX IF NOT EXISTS idx_account_snapshots_account_id ON account_snapshots(account_id);
      CREATE INDEX IF NOT EXISTS idx_operations_account_id ON operations(account_id);
      CREATE INDEX IF NOT EXISTS idx_secrets_account_id ON secrets(account_id);
    `);
  },
};
