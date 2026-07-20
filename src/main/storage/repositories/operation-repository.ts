import type Database from 'better-sqlite3';

export type OperationStatus = 'success' | 'error';

export interface OperationEntity {
  id: string;
  accountId: string;
  kind: string;
  status: OperationStatus;
  startedAt: string;
  finishedAt?: string;
  errorCode?: string;
  errorSummary?: string;
}

function mapRow(row: Record<string, unknown>): OperationEntity {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    kind: String(row.kind),
    status: String(row.status) as OperationStatus,
    startedAt: String(row.started_at),
    finishedAt: row.finished_at ? String(row.finished_at) : undefined,
    errorCode: row.error_code ? String(row.error_code) : undefined,
    errorSummary: row.error_summary ? String(row.error_summary) : undefined,
  };
}

export class OperationRepository {
  constructor(private readonly database: Database.Database) {}

  /**
   * 记录一次操作（刷新、会话校验、签到等）。
   * error_summary 只存脱敏摘要，绝不写原始响应体、完整 URL query 或 Cookie。
   */
  record(entity: OperationEntity): void {
    this.database
      .prepare(
        `INSERT INTO operations (
          id,
          account_id,
          kind,
          status,
          started_at,
          finished_at,
          error_code,
          error_summary,
          details_json
        ) VALUES (
          @id,
          @accountId,
          @kind,
          @status,
          @startedAt,
          @finishedAt,
          @errorCode,
          @errorSummary,
          NULL
        )`,
      )
      .run({
        id: entity.id,
        accountId: entity.accountId,
        kind: entity.kind,
        status: entity.status,
        startedAt: entity.startedAt,
        finishedAt: entity.finishedAt ?? null,
        errorCode: entity.errorCode ?? null,
        errorSummary: entity.errorSummary ?? null,
      });
  }

  /** 取该账户最近的操作记录（按开始时间倒序）。 */
  listRecent(accountId: string, limit = 50): OperationEntity[] {
    const rows = this.database
      .prepare(
        'SELECT * FROM operations WHERE account_id = ? ORDER BY started_at DESC LIMIT ?',
      )
      .all(accountId, limit) as Array<Record<string, unknown>>;

    return rows.map(mapRow);
  }
}
