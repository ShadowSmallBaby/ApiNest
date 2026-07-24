import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { siteOAuthConfigsMigration } from './010-site-oauth-configs';

describe('migration 010: site-oauth-configs', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    // 先运行前置迁移（创建 sites 表）
    db.exec(`
      CREATE TABLE sites (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        platform TEXT NOT NULL,
        base_url TEXT NOT NULL,
        linuxdo_client_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  });

  afterEach(() => {
    db.close();
  });

  it('应该创建 site_oauth_configs 表', () => {
    siteOAuthConfigsMigration.up(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='site_oauth_configs'")
      .all();
    expect(tables).toHaveLength(1);
  });

  it('应该创建索引 idx_site_oauth_configs_site_id', () => {
    siteOAuthConfigsMigration.up(db);

    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_site_oauth_configs_site_id'",
      )
      .all();
    expect(indexes).toHaveLength(1);
  });

  it('应该迁移历史 linuxdo_client_id 数据', () => {
    const siteId = randomUUID();
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO sites (id, name, platform, base_url, linuxdo_client_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(siteId, '测试站点', 'newapi', 'https://example.com', 'linuxdo_client_123', now, now);

    siteOAuthConfigsMigration.up(db);

    const configs = db.prepare('SELECT * FROM site_oauth_configs WHERE site_id = ?').all(siteId);
    expect(configs).toHaveLength(1);
    expect(configs[0]).toMatchObject({
      site_id: siteId,
      oauth_provider: 'linuxdo',
      client_id: 'linuxdo_client_123',
    });
  });

  it('应该忽略空的 linuxdo_client_id', () => {
    const siteId = randomUUID();
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO sites (id, name, platform, base_url, linuxdo_client_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(siteId, '测试站点', 'newapi', 'https://example.com', '', now, now);

    siteOAuthConfigsMigration.up(db);

    const configs = db.prepare('SELECT * FROM site_oauth_configs WHERE site_id = ?').all(siteId);
    expect(configs).toHaveLength(0);
  });

  it('应该强制 UNIQUE(site_id, oauth_provider)', () => {
    siteOAuthConfigsMigration.up(db);

    const siteId = randomUUID();
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO sites (id, name, platform, base_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(siteId, '测试站点', 'newapi', 'https://example.com', now, now);

    const insertConfig = db.prepare(`
      INSERT INTO site_oauth_configs (id, site_id, oauth_provider, client_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    insertConfig.run(randomUUID(), siteId, 'github', 'gh_123', now, now);

    expect(() => {
      insertConfig.run(randomUUID(), siteId, 'github', 'gh_456', now, now);
    }).toThrow(/UNIQUE constraint failed/i);
  });

  it('应该级联删除站点关联的 OAuth 配置', () => {
    siteOAuthConfigsMigration.up(db);

    const siteId = randomUUID();
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO sites (id, name, platform, base_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(siteId, '测试站点', 'newapi', 'https://example.com', now, now);

    db.prepare(
      `INSERT INTO site_oauth_configs (id, site_id, oauth_provider, client_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), siteId, 'github', 'gh_123', now, now);

    db.prepare('DELETE FROM sites WHERE id = ?').run(siteId);

    const configs = db.prepare('SELECT * FROM site_oauth_configs WHERE site_id = ?').all(siteId);
    expect(configs).toHaveLength(0);
  });
});
