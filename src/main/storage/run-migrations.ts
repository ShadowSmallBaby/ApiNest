import type Database from 'better-sqlite3';
import { STORAGE_SCHEMA_VERSION } from './constants';
import type { Migration } from './migration';
import { migrations } from './migrations';

function ensureSchemaMetaTable(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
}

function getAppliedVersions(database: Database.Database): Set<number> {
  const rows = database.prepare('SELECT version FROM schema_meta ORDER BY version ASC').all() as Array<{
    version: number;
  }>;

  return new Set(rows.map(row => row.version));
}

function applyMigration(database: Database.Database, migration: Migration): void {
  const now = new Date().toISOString();

  const runMigration = database.transaction(() => {
    migration.up(database);
    database
      .prepare('INSERT INTO schema_meta (version, applied_at) VALUES (?, ?)')
      .run(migration.version, now);
  });

  runMigration();
}

export function runMigrations(database: Database.Database): void {
  ensureSchemaMetaTable(database);

  const appliedVersions = getAppliedVersions(database);

  for (const migration of migrations) {
    if (!appliedVersions.has(migration.version)) {
      applyMigration(database, migration);
    }
  }

  const row = database
    .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_meta')
    .get() as { version: number } | undefined;

  const currentVersion = row?.version ?? 0;

  if (currentVersion !== STORAGE_SCHEMA_VERSION) {
    throw new Error(
      `Unexpected schema version ${currentVersion}. Expected ${STORAGE_SCHEMA_VERSION}.`,
    );
  }
}
