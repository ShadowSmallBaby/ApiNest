import type Database from 'better-sqlite3';
import type { AuthState } from '../../../shared/ipc/bridge';

export interface AccountAuthStateEntity {
  accountId: string;
  state: AuthState;
  lastVerifiedAt?: string;
  lastErrorCode?: string;
  lastErrorSummary?: string;
  /** NewAPI 站内数字用户 ID（认证元数据，非凭据）；未捕获时为 undefined。 */
  siteUserId?: string;
  /** 站内用户 ID 捕获时间（ISO）；未捕获时为 undefined。 */
  identityCapturedAt?: string;
}

function mapRow(row: Record<string, unknown>): AccountAuthStateEntity {
  return {
    accountId: String(row.account_id),
    state: String(row.state) as AuthState,
    lastVerifiedAt: row.last_verified_at ? String(row.last_verified_at) : undefined,
    lastErrorCode: row.last_error_code ? String(row.last_error_code) : undefined,
    lastErrorSummary: row.last_error_summary ? String(row.last_error_summary) : undefined,
    siteUserId: row.site_user_id ? String(row.site_user_id) : undefined,
    identityCapturedAt: row.identity_captured_at ? String(row.identity_captured_at) : undefined,
  };
}

export class AccountAuthStateRepository {
  constructor(private readonly database: Database.Database) {}

  get(accountId: string): AccountAuthStateEntity | null {
    const row = this.database
      .prepare('SELECT * FROM account_auth_state WHERE account_id = ?')
      .get(accountId) as Record<string, unknown> | undefined;

    return row ? mapRow(row) : null;
  }

  getMany(accountIds: string[]): Map<string, AccountAuthStateEntity> {
    const result = new Map<string, AccountAuthStateEntity>();
    if (accountIds.length === 0) {
      return result;
    }

    const placeholders = accountIds.map(() => '?').join(', ');
    const rows = this.database
      .prepare(`SELECT * FROM account_auth_state WHERE account_id IN (${placeholders})`)
      .all(...accountIds) as Array<Record<string, unknown>>;

    for (const row of rows) {
      const entity = mapRow(row);
      result.set(entity.accountId, entity);
    }

    return result;
  }

  upsert(entity: AccountAuthStateEntity): void {
    this.database
      .prepare(
        `INSERT INTO account_auth_state (
          account_id,
          state,
          last_verified_at,
          last_error_code,
          last_error_summary
        ) VALUES (
          @accountId,
          @state,
          @lastVerifiedAt,
          @lastErrorCode,
          @lastErrorSummary
        )
        ON CONFLICT(account_id) DO UPDATE SET
          state = excluded.state,
          last_verified_at = excluded.last_verified_at,
          last_error_code = excluded.last_error_code,
          last_error_summary = excluded.last_error_summary`,
      )
      .run({
        accountId: entity.accountId,
        state: entity.state,
        lastVerifiedAt: entity.lastVerifiedAt ?? null,
        lastErrorCode: entity.lastErrorCode ?? null,
        lastErrorSummary: entity.lastErrorSummary ?? null,
      });
  }

  /** 读取账户的 NewAPI 站内数字用户 ID；未捕获时返回 null。 */
  getSiteUserId(accountId: string): string | null {
    const row = this.database
      .prepare('SELECT site_user_id FROM account_auth_state WHERE account_id = ?')
      .get(accountId) as { site_user_id: unknown } | undefined;

    return row?.site_user_id ? String(row.site_user_id) : null;
  }

  /**
   * 写入/更新账户的站内用户 ID 与捕获时间。
   *
   * 首次插入时 state 置 'unknown'（登录尚未完成校验）；已存在则只更新身份两列，
   * 绝不覆盖 state / last_verified_at / last_error_*，避免破坏既有会话状态。
   */
  upsertSiteIdentity(accountId: string, siteUserId: string, capturedAt: string): void {
    this.database
      .prepare(
        `INSERT INTO account_auth_state (account_id, state, site_user_id, identity_captured_at)
         VALUES (@accountId, 'unknown', @siteUserId, @capturedAt)
         ON CONFLICT(account_id) DO UPDATE SET
           site_user_id = excluded.site_user_id,
           identity_captured_at = excluded.identity_captured_at`,
      )
      .run({ accountId, siteUserId, capturedAt });
  }

  /**
   * 清除账户的站内用户 ID 与捕获时间（清会话时调用）。
   * 只清身份两列，保留 state 记录；账户行不存在时为无操作。
   */
  clearSiteIdentity(accountId: string): void {
    this.database
      .prepare(
        `UPDATE account_auth_state
         SET site_user_id = NULL, identity_captured_at = NULL
         WHERE account_id = ?`,
      )
      .run(accountId);
  }
}
