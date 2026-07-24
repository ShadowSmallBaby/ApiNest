import type Database from 'better-sqlite3';
import type { CheckInResult } from '../../../shared/ipc/bridge';

export interface StoredCheckInResult extends CheckInResult {
  operationId: string;
  checkedAt: string;
}

function mapRow(row: Record<string, unknown>): StoredCheckInResult {
  return {
    operationId: String(row.operation_id),
    accountId: String(row.account_id),
    result: String(row.result) as CheckInResult['result'],
    message: row.message ? String(row.message) : '',
    checkedAt: String(row.checked_at),
  };
}

/** 仅保存可展示的签到结果，不保存目标站点响应、Cookie 或其他凭据。 */
export class CheckInResultRepository {
  constructor(private readonly database: Database.Database) {}

  record(entity: StoredCheckInResult): void {
    this.database.prepare(
      `INSERT INTO checkin_results (
        operation_id, account_id, result, message, checked_at
      ) VALUES (
        @operationId, @accountId, @result, @message, @checkedAt
      )`,
    ).run(entity);
  }

  listRecent(accountId: string, limit = 20): StoredCheckInResult[] {
    const rows = this.database.prepare(
      `SELECT * FROM checkin_results
       WHERE account_id = ?
       ORDER BY checked_at DESC
       LIMIT ?`,
    ).all(accountId, limit) as Array<Record<string, unknown>>;

    return rows.map(mapRow);
  }

  /**
   * 统计各站点今日已签到的去重账号数（分子）。
   * 仅计 result ∈ {success, already_checked_in} 且 checked_at >= 今日 0 点的记录，
   * 按 site_id 分组去重 account_id。返回 Map<siteId, 去重账号数>。
   */
  countCheckedInTodayBySite(todayStartIso: string): Map<string, number> {
    const rows = this.database.prepare(
      `SELECT a.site_id AS site_id, COUNT(DISTINCT c.account_id) AS checked_in
       FROM checkin_results c
       JOIN accounts a ON a.id = c.account_id
       WHERE c.checked_at >= ?
         AND c.result IN ('success', 'already_checked_in')
       GROUP BY a.site_id`,
    ).all(todayStartIso) as Array<{ site_id: string; checked_in: number }>;

    const result = new Map<string, number>();
    for (const row of rows) {
      result.set(String(row.site_id), Number(row.checked_in));
    }
    return result;
  }
}
