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
}
