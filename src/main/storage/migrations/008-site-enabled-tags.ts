import type Database from 'better-sqlite3';
import type { Migration } from '../migration';

/**
 * 迁移 008：站点启用状态与标签。
 *
 * 为 sites 增加 enabled（启用/禁用开关，默认启用）与 tags_json（标签数组的 JSON 文本，
 * 默认空数组）。升级后既有站点保持启用、无标签，出口与会话隔离行为不变——二者均为
 * 纯管理性元数据，仅用于站点广场的展示与筛选。
 */
export const siteEnabledTagsMigration: Migration = {
  version: 8,
  name: 'site-enabled-tags',
  up(database: Database.Database): void {
    // 启用开关，默认 1（启用），保证既有站点升级后仍出现在默认「仅启用」视图中。
    addSiteColumnIfMissing(
      database,
      'enabled',
      `ALTER TABLE sites ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1));`,
    );
    // 标签数组以 JSON 文本存储（SQLite 无数组类型），默认空数组，语义为「无标签」。
    addSiteColumnIfMissing(
      database,
      'tags_json',
      `ALTER TABLE sites ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';`,
    );
  },
};

/** 幂等地为 sites 表补充列；列名与 DDL 均为固定字面量，非用户输入。 */
function addSiteColumnIfMissing(database: Database.Database, column: string, ddl: string): void {
  const columns = database.prepare('PRAGMA table_info(sites)').all() as Array<{ name: string }>;
  if (!columns.some(item => item.name === column)) {
    database.exec(ddl);
  }
}
