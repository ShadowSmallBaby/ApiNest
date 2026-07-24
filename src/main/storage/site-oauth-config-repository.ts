import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { OAuthProvider, SiteOAuthConfig } from '../../shared/ipc/bridge';

interface SiteOAuthConfigRow {
  id: string;
  site_id: string;
  oauth_provider: string;
  client_id: string;
  note: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * 站点级 OAuth 配置仓储。
 *
 * 职责：
 * - CRUD site_oauth_configs 表
 * - 支持多个 OAuth 提供商配置（github、linuxdo）
 * - 唯一约束：UNIQUE(site_id, oauth_provider)
 */
export class SiteOAuthConfigRepository {
  constructor(private readonly database: Database.Database) {}

  /**
   * 获取站点所有 OAuth 配置。
   */
  list(siteId: string): SiteOAuthConfig[] {
    const rows = this.database
      .prepare(
        `SELECT id, site_id, oauth_provider, client_id, note, created_at, updated_at
         FROM site_oauth_configs
         WHERE site_id = ?
         ORDER BY created_at ASC, oauth_provider ASC`,
      )
      .all(siteId) as SiteOAuthConfigRow[];

    return rows.map(this.mapRow);
  }

  /**
   * 获取特定 OAuth 提供商的 Client ID。
   * 未配置时返回 null。
   */
  getClientId(siteId: string, provider: OAuthProvider): string | null {
    const row = this.database
      .prepare(
        `SELECT client_id
         FROM site_oauth_configs
         WHERE site_id = ? AND oauth_provider = ?`,
      )
      .get(siteId, provider) as { client_id: string } | undefined;

    return row?.client_id ?? null;
  }

  /**
   * 创建或更新 OAuth 配置（Upsert）。
   * 已存在时更新 client_id 和 note。
   */
  upsert(siteId: string, provider: OAuthProvider, clientId: string, note?: string): void {
    const now = new Date().toISOString();
    const existing = this.database
      .prepare(
        `SELECT id FROM site_oauth_configs
         WHERE site_id = ? AND oauth_provider = ?`,
      )
      .get(siteId, provider) as { id: string } | undefined;

    if (existing) {
      // 更新已有配置
      this.database
        .prepare(
          `UPDATE site_oauth_configs
           SET client_id = ?, note = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(clientId, note ?? null, now, existing.id);
    } else {
      // 创建新配置
      this.database
        .prepare(
          `INSERT INTO site_oauth_configs (
            id, site_id, oauth_provider, client_id, note, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(randomUUID(), siteId, provider, clientId, note ?? null, now, now);
    }
  }

  /**
   * 删除 OAuth 配置。
   */
  delete(siteId: string, provider: OAuthProvider): void {
    this.database
      .prepare(
        `DELETE FROM site_oauth_configs
         WHERE site_id = ? AND oauth_provider = ?`,
      )
      .run(siteId, provider);
  }

  /**
   * 删除站点的所有 OAuth 配置（级联删除，通常由 FK 自动完成）。
   */
  deleteAllBySite(siteId: string): void {
    this.database
      .prepare('DELETE FROM site_oauth_configs WHERE site_id = ?')
      .run(siteId);
  }

  private mapRow(row: SiteOAuthConfigRow): SiteOAuthConfig {
    return {
      id: row.id,
      siteId: row.site_id,
      oauthProvider: row.oauth_provider as OAuthProvider,
      clientId: row.client_id,
      note: row.note ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
