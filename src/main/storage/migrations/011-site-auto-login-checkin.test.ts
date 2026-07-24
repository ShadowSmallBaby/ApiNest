import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { siteAutoLoginCheckinMigration } from './011-site-auto-login-checkin';

describe('migration 011: site-auto-login-checkin', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE sites (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        platform TEXT NOT NULL,
        base_url TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  });

  afterEach(() => {
    db.close();
  });

  it('adds auto_login / auto_checkin / check_in_site_url columns', () => {
    siteAutoLoginCheckinMigration.up(db);
    const columns = db.prepare('PRAGMA table_info(sites)').all() as Array<{ name: string }>;
    const names = columns.map(column => column.name);
    expect(names).toContain('auto_login');
    expect(names).toContain('auto_checkin');
    expect(names).toContain('check_in_site_url');
  });

  it('is idempotent when run twice', () => {
    siteAutoLoginCheckinMigration.up(db);
    expect(() => siteAutoLoginCheckinMigration.up(db)).not.toThrow();
  });

  it('defaults new columns to off / null for existing rows', () => {
    db.prepare(
      `INSERT INTO sites (id, name, platform, base_url, created_at, updated_at)
       VALUES ('s1', '主站', 'newapi', 'https://example.com', 't', 't')`,
    ).run();
    siteAutoLoginCheckinMigration.up(db);
    const row = db.prepare('SELECT auto_login, auto_checkin, check_in_site_url FROM sites WHERE id = ?').get('s1') as {
      auto_login: number;
      auto_checkin: number;
      check_in_site_url: string | null;
    };
    expect(row.auto_login).toBe(0);
    expect(row.auto_checkin).toBe(0);
    expect(row.check_in_site_url).toBeNull();
  });
});
