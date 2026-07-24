import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { SiteOAuthConfigRepository } from './site-oauth-config-repository';

describe('SiteOAuthConfigRepository', () => {
  let db: Database.Database;
  let repo: SiteOAuthConfigRepository;
  let siteId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    // 创建依赖的表结构
    db.exec(`
      CREATE TABLE sites (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        platform TEXT NOT NULL,
        base_url TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE site_oauth_configs (
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
    `);

    repo = new SiteOAuthConfigRepository(db);
    siteId = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO sites (id, name, platform, base_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(siteId, '测试站点', 'newapi', 'https://example.com', now, now);
  });

  afterEach(() => {
    db.close();
  });

  describe('upsert', () => {
    it('应该创建新的 OAuth 配置', () => {
      repo.upsert(siteId, 'github', 'gh_client_123', '用于 GitHub 登录');

      const configs = repo.list(siteId);
      expect(configs).toHaveLength(1);
      expect(configs[0]).toMatchObject({
        siteId,
        oauthProvider: 'github',
        clientId: 'gh_client_123',
        note: '用于 GitHub 登录',
      });
    });

    it('应该更新已存在的 OAuth 配置', () => {
      repo.upsert(siteId, 'github', 'gh_client_123');
      repo.upsert(siteId, 'github', 'gh_client_456', '更新后的备注');

      const configs = repo.list(siteId);
      expect(configs).toHaveLength(1);
      expect(configs[0]).toMatchObject({
        oauthProvider: 'github',
        clientId: 'gh_client_456',
        note: '更新后的备注',
      });
    });

    it('应该支持同一站点多个 OAuth 提供商', () => {
      repo.upsert(siteId, 'github', 'gh_client_123');
      repo.upsert(siteId, 'linuxdo', 'ld_client_456');

      const configs = repo.list(siteId);
      expect(configs).toHaveLength(2);
      expect(configs.map(c => c.oauthProvider)).toEqual(['github', 'linuxdo']);
    });
  });

  describe('getClientId', () => {
    it('应该返回已配置的 Client ID', () => {
      repo.upsert(siteId, 'github', 'gh_client_123');

      const clientId = repo.getClientId(siteId, 'github');
      expect(clientId).toBe('gh_client_123');
    });

    it('未配置时应该返回 null', () => {
      const clientId = repo.getClientId(siteId, 'github');
      expect(clientId).toBeNull();
    });

    it('应该区分不同的 OAuth 提供商', () => {
      repo.upsert(siteId, 'github', 'gh_client_123');

      const githubClientId = repo.getClientId(siteId, 'github');
      const linuxdoClientId = repo.getClientId(siteId, 'linuxdo');

      expect(githubClientId).toBe('gh_client_123');
      expect(linuxdoClientId).toBeNull();
    });
  });

  describe('list', () => {
    it('空站点应该返回空数组', () => {
      const configs = repo.list(siteId);
      expect(configs).toEqual([]);
    });

    it('应该返回站点所有 OAuth 配置', () => {
      repo.upsert(siteId, 'github', 'gh_client_123');
      repo.upsert(siteId, 'linuxdo', 'ld_client_456');

      const configs = repo.list(siteId);
      expect(configs).toHaveLength(2);
    });

    it('应该返回全部配置（创建时间相同时按 provider 稳定排序）', () => {
      // 同秒写入时 created_at 可能相同；二级排序 oauth_provider 保证稳定顺序。
      repo.upsert(siteId, 'linuxdo', 'ld_client_456');
      repo.upsert(siteId, 'github', 'gh_client_123');

      const configs = repo.list(siteId);
      expect(configs.map(item => item.oauthProvider).sort()).toEqual(['github', 'linuxdo']);
      // 同秒时 github < linuxdo（字典序）
      if (configs[0].createdAt === configs[1].createdAt) {
        expect(configs.map(item => item.oauthProvider)).toEqual(['github', 'linuxdo']);
      }
    });
  });

  describe('delete', () => {
    it('应该删除指定的 OAuth 配置', () => {
      repo.upsert(siteId, 'github', 'gh_client_123');
      repo.upsert(siteId, 'linuxdo', 'ld_client_456');

      repo.delete(siteId, 'github');

      const configs = repo.list(siteId);
      expect(configs).toHaveLength(1);
      expect(configs[0].oauthProvider).toBe('linuxdo');
    });

    it('删除不存在的配置不应该报错', () => {
      expect(() => {
        repo.delete(siteId, 'github');
      }).not.toThrow();
    });
  });

  describe('deleteAllBySite', () => {
    it('应该删除站点的所有 OAuth 配置', () => {
      repo.upsert(siteId, 'github', 'gh_client_123');
      repo.upsert(siteId, 'linuxdo', 'ld_client_456');

      repo.deleteAllBySite(siteId);

      const configs = repo.list(siteId);
      expect(configs).toEqual([]);
    });
  });

  describe('级联删除', () => {
    it('删除站点应该自动删除 OAuth 配置', () => {
      repo.upsert(siteId, 'github', 'gh_client_123');

      db.prepare('DELETE FROM sites WHERE id = ?').run(siteId);

      const configs = repo.list(siteId);
      expect(configs).toEqual([]);
    });
  });
});
