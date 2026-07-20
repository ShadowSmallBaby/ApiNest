import type { Migration } from '../migration';

/** 为历史数据库补齐签到查询索引；表本身来自首个基础迁移。 */
export const checkinResultsIndexMigration: Migration = {
  version: 3,
  name: 'checkin-results-index',
  up(database): void {
    database.exec(`
      CREATE INDEX IF NOT EXISTS idx_checkin_results_account_checked_at
      ON checkin_results(account_id, checked_at DESC);
    `);
  },
};
