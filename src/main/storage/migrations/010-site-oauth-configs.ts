import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Migration } from '../migration';

/**
 * 迁移 010：新增站点级多 OAuth 配置表。
 *
 * 背景：
 * - 当前 sites 表只有单一 linuxdo_client_id 字段
 * - 无法支持同一站点配置多个 OAuth 提供商（GitHub、LinuxDo 等）
 * - 不同账户需要选择不同 OAuth 方式认证
 *
 * 方案：
 * - 新增 site_oauth_configs 表，存储站点级 OAuth 配置
 * - 每行一个 OAuth 提供商配置（oauth_provider + client_id）
 * - UNIQUE(site_id, oauth_provider) 确保同站点同提供商唯一
 * - 自动迁移历史 linuxdo_client_id 数据到新表
 * - 保留 sites.linuxdo_client_id 列用于向后兼容，新逻辑优先读新表
 */
export const siteOAuthConfigsMigration: Migration = {
  version: 10,
  name: 'site-oauth-configs',
  up(database: Database.Database): void {
    // 1. 创建 site_oauth_configs 表
    database.exec(`
      CREATE TABLE IF NOT EXISTS site_oauth_configs (
        id TEXT PRIMARY KEY,
        site_id TEXT NOT NULL,
        oauth_provider TEXT NOT NULL CHECK(oauth_provider IN ('github', 'linuxdo')),
        client_id TEXT NOT NULL CHECK(length(trim(client_id)) > 0),
        note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
        UNIQUE(site_id, oauth_provider)
      );

      CREATE INDEX IF NOT EXISTS idx_site_oauth_configs_site_id
        ON site_oauth_configs(site_id);
    `);

    // 2. 迁移历史 linuxdo_client_id 到新表
    const sitesWithLinuxDo = database
      .prepare(
        `SELECT id, linuxdo_client_id, updated_at
         FROM sites
         WHERE linuxdo_client_id IS NOT NULL
           AND trim(linuxdo_client_id) != ''`,
      )
      .all() as Array<{ id: string; linuxdo_client_id: string; updated_at: string }>;

    const insertOAuthConfig = database.prepare(`
      INSERT INTO site_oauth_configs (
        id, site_id, oauth_provider, client_id, note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const site of sitesWithLinuxDo) {
      insertOAuthConfig.run(
        randomUUID(),
        site.id,
        'linuxdo',
        site.linuxdo_client_id.trim(),
        null,
        site.updated_at,
        site.updated_at,
      );
    }
  },
};
