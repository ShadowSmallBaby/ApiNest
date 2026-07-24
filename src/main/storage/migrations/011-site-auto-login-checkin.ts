import type Database from 'better-sqlite3';
import type { Migration } from '../migration';

/**
 * 迁移 011：站点自动登录 / 自动签到 / 额外签到站 URL。
 *
 * - auto_login：参与广场一键登录；要求账户非 CK 且站点配置了对应 OAuth
 * - auto_checkin：参与广场一键 API 签到；与 check_in_site_url 互斥
 * - check_in_site_url：额外签到站完整 URL；有值时签到改为打开该地址手动完成
 */
export const siteAutoLoginCheckinMigration: Migration = {
  version: 11,
  name: 'site-auto-login-checkin',
  up(database: Database.Database): void {
    addSiteColumnIfMissing(
      database,
      'auto_login',
      `ALTER TABLE sites ADD COLUMN auto_login INTEGER NOT NULL DEFAULT 0 CHECK (auto_login IN (0, 1));`,
    );
    addSiteColumnIfMissing(
      database,
      'auto_checkin',
      `ALTER TABLE sites ADD COLUMN auto_checkin INTEGER NOT NULL DEFAULT 0 CHECK (auto_checkin IN (0, 1));`,
    );
    addSiteColumnIfMissing(
      database,
      'check_in_site_url',
      `ALTER TABLE sites ADD COLUMN check_in_site_url TEXT;`,
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
