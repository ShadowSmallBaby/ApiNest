import type Database from 'better-sqlite3';

export interface AuthIdentityEntity {
  id: string;
  kind: string;
  label: string;
  note?: string;
  /** 是否让该身份的登录窗口联网走全局 Proxy 模板；默认 false（直连）。 */
  useProxy: boolean;
  createdAt: string;
  updatedAt: string;
}

function mapRow(row: Record<string, unknown>): AuthIdentityEntity {
  return {
    id: String(row.id),
    kind: String(row.kind),
    label: String(row.label),
    note: row.note ? String(row.note) : undefined,
    useProxy: Number(row.use_proxy) === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/**
 * auth 身份仓储（R13 演进）。
 *
 * 只存 auth 身份的非敏感元数据（类型、标签、备注）；password 类型的账号密码
 * 明文绝不入此表，仍走 secrets 表加密存储，secret_id 由 auth id 派生。
 */
export class AuthIdentityRepository {
  constructor(private readonly database: Database.Database) {}

  create(entity: AuthIdentityEntity): void {
    this.database
      .prepare(
        `INSERT INTO auth_identities (
          id, kind, label, note, use_proxy, created_at, updated_at
        ) VALUES (
          @id, @kind, @label, @note, @useProxy, @createdAt, @updatedAt
        )`,
      )
      .run({ ...entity, note: entity.note ?? null, useProxy: entity.useProxy ? 1 : 0 });
  }

  list(): AuthIdentityEntity[] {
    const rows = this.database
      .prepare('SELECT * FROM auth_identities ORDER BY created_at ASC')
      .all();
    return rows.map(row => mapRow(row as Record<string, unknown>));
  }

  get(id: string): AuthIdentityEntity | null {
    const row = this.database.prepare('SELECT * FROM auth_identities WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;

    return row ? mapRow(row) : null;
  }

  update(entity: AuthIdentityEntity): void {
    this.database
      .prepare(
        `UPDATE auth_identities SET
          label = @label,
          note = @note,
          use_proxy = @useProxy,
          updated_at = @updatedAt
        WHERE id = @id`,
      )
      .run({ ...entity, note: entity.note ?? null, useProxy: entity.useProxy ? 1 : 0 });
  }

  delete(id: string): void {
    this.database.prepare('DELETE FROM auth_identities WHERE id = ?').run(id);
  }
}
