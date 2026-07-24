import type Database from 'better-sqlite3';

/**
 * 本地密钥表元数据（非敏感）。远程 NewAPI token 列表拉回后展开为逐条记录持久化。
 * 绝不含完整明文——明文走 Vault secrets 表信封，本表仅以 plaintextSecretId 引用。
 */
export interface AccountKeyMetadata {
  /** 平台侧 token 数字 id（与 site_id 组成唯一键）。 */
  tokenId: number;
  name: string;
  /** 脱敏后的 key 展示串（如 sk-…abcd），绝不是完整明文。 */
  maskedKey: string;
  group?: string;
  remainQuota: number;
  unlimitedQuota: boolean;
  usedQuota: number;
  status: number;
  createdTime: number;
  expiredTime: number;
}

/** 本地密钥表整行实体（元数据 + 明文引用 + 站点/账号引用）。 */
export interface AccountKeyEntity extends AccountKeyMetadata {
  siteId: string;
  accountId: string;
  /** 明文密文在 Vault secrets 表的引用 id；未惰性获取时为 undefined。 */
  plaintextSecretId?: string;
  /** 明文入库时间（ISO）；未入库时为 undefined。 */
  capturedAt?: string;
  updatedAt: string;
}

/** 覆盖某账户元数据的入参（refresh 拉回的远程全量列表）。 */
export interface ReplaceAccountKeysInput {
  accountId: string;
  siteId: string;
  records: AccountKeyMetadata[];
  updatedAt: string;
}

function mapRow(row: Record<string, unknown>): AccountKeyEntity {
  return {
    tokenId: Number(row.token_id),
    siteId: String(row.site_id),
    accountId: String(row.account_id),
    name: String(row.name),
    maskedKey: String(row.masked_key),
    group: row.group_name ? String(row.group_name) : undefined,
    remainQuota: Number(row.remain_quota),
    unlimitedQuota: Number(row.unlimited_quota) === 1,
    usedQuota: Number(row.used_quota),
    status: Number(row.status),
    createdTime: Number(row.created_time),
    expiredTime: Number(row.expired_time),
    plaintextSecretId: row.plaintext_secret_id ? String(row.plaintext_secret_id) : undefined,
    capturedAt: row.captured_at ? String(row.captured_at) : undefined,
    updatedAt: String(row.updated_at),
  };
}

/**
 * 本地密钥表仓储（纯 SQLite）。
 *
 * 只负责元数据行的读写与明文引用登记；不接触 Vault 加解密（职责分离，
 * 明文密文的写入/清理由 KeysService 编排）。
 */
export class AccountKeysRepository {
  constructor(private readonly database: Database.Database) {}

  /** 读取某账户的本地密钥列表（按创建时间升序，稳定序）。 */
  listByAccount(accountId: string): AccountKeyEntity[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM account_keys WHERE account_id = ?
         ORDER BY created_time ASC, token_id ASC`,
      )
      .all(accountId) as Array<Record<string, unknown>>;
    return rows.map(mapRow);
  }

  /** 读取单行（用于揭示时定位明文引用）。 */
  get(tokenId: number, siteId: string): AccountKeyEntity | null {
    const row = this.database
      .prepare('SELECT * FROM account_keys WHERE token_id = ? AND site_id = ?')
      .get(tokenId, siteId) as Record<string, unknown> | undefined;
    return row ? mapRow(row) : null;
  }

  /**
   * 以远程全量列表覆盖某账户的元数据（refresh 语义）：
   * - 事务内 upsert 每条元数据；**绝不覆盖已入库的明文引用**（plaintext_secret_id /
   *   captured_at），因为 token id 稳定、明文照旧有效；
   * - 删除远程已消失（本地存在但不在本次列表）的行，并回传其明文引用 id，
   *   供上层清理 Vault 中的孤儿密文。
   */
  replaceAccountMetadata(input: ReplaceAccountKeysInput): { orphanSecretIds: string[] } {
    const run = this.database.transaction((payload: ReplaceAccountKeysInput) => {
      const existing = this.database
        .prepare('SELECT token_id, plaintext_secret_id FROM account_keys WHERE account_id = ?')
        .all(payload.accountId) as Array<{ token_id: number; plaintext_secret_id: string | null }>;

      const incomingIds = new Set(payload.records.map(record => record.tokenId));
      const orphanSecretIds: string[] = [];
      const deleteStatement = this.database.prepare(
        'DELETE FROM account_keys WHERE token_id = ? AND site_id = ?',
      );
      for (const row of existing) {
        if (!incomingIds.has(row.token_id)) {
          if (row.plaintext_secret_id) {
            orphanSecretIds.push(row.plaintext_secret_id);
          }
          deleteStatement.run(row.token_id, payload.siteId);
        }
      }

      // upsert 只写元数据列，保留 plaintext_secret_id / captured_at（惰性明文不丢）。
      const upsertStatement = this.database.prepare(
        `INSERT INTO account_keys (
          token_id, site_id, account_id, name, masked_key, group_name,
          remain_quota, unlimited_quota, used_quota, status,
          created_time, expired_time, updated_at
        ) VALUES (
          @tokenId, @siteId, @accountId, @name, @maskedKey, @groupName,
          @remainQuota, @unlimitedQuota, @usedQuota, @status,
          @createdTime, @expiredTime, @updatedAt
        )
        ON CONFLICT(token_id, site_id) DO UPDATE SET
          account_id = excluded.account_id,
          name = excluded.name,
          masked_key = excluded.masked_key,
          group_name = excluded.group_name,
          remain_quota = excluded.remain_quota,
          unlimited_quota = excluded.unlimited_quota,
          used_quota = excluded.used_quota,
          status = excluded.status,
          created_time = excluded.created_time,
          expired_time = excluded.expired_time,
          updated_at = excluded.updated_at`,
      );
      for (const record of payload.records) {
        upsertStatement.run({
          tokenId: record.tokenId,
          siteId: payload.siteId,
          accountId: payload.accountId,
          name: record.name,
          maskedKey: record.maskedKey,
          groupName: record.group ?? null,
          remainQuota: record.remainQuota,
          unlimitedQuota: record.unlimitedQuota ? 1 : 0,
          usedQuota: record.usedQuota,
          status: record.status,
          createdTime: record.createdTime,
          expiredTime: record.expiredTime,
          updatedAt: payload.updatedAt,
        });
      }

      return { orphanSecretIds };
    });

    return run(input);
  }

  /** 登记明文引用（惰性获取明文并加密入库后调用）。 */
  attachPlaintext(tokenId: number, siteId: string, secretId: string, capturedAt: string): void {
    this.database
      .prepare(
        `UPDATE account_keys
         SET plaintext_secret_id = @secretId, captured_at = @capturedAt
         WHERE token_id = @tokenId AND site_id = @siteId`,
      )
      .run({ tokenId, siteId, secretId, capturedAt });
  }

  /**
   * 删除某账户全部本地密钥，回传其明文引用 id 供清理 Vault 密文。
   * （账户/站点删除已由外键级联清理本表；此方法用于显式重置场景。）
   */
  deleteByAccount(accountId: string): { orphanSecretIds: string[] } {
    const run = this.database.transaction((id: string) => {
      const rows = this.database
        .prepare('SELECT plaintext_secret_id FROM account_keys WHERE account_id = ?')
        .all(id) as Array<{ plaintext_secret_id: string | null }>;
      const orphanSecretIds = rows
        .map(row => row.plaintext_secret_id)
        .filter((value): value is string => Boolean(value));
      this.database.prepare('DELETE FROM account_keys WHERE account_id = ?').run(id);
      return { orphanSecretIds };
    });
    return run(accountId);
  }
}
