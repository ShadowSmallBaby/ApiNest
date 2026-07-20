import type Database from 'better-sqlite3';

export interface SecretEntity {
  secretId: string;
  accountId: string;
  purpose: string;
  ciphertext: Buffer;
  nonce: Buffer;
  encryptionVersion: number;
  createdAt: string;
  updatedAt: string;
}

function mapRow(row: Record<string, unknown>): SecretEntity {
  return {
    secretId: String(row.secret_id),
    accountId: String(row.account_id),
    purpose: String(row.purpose),
    ciphertext: row.ciphertext as Buffer,
    nonce: row.nonce as Buffer,
    encryptionVersion: Number(row.encryption_version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class SecretRepository {
  constructor(private readonly database: Database.Database) {}

  upsert(entity: SecretEntity): void {
    this.database
      .prepare(
        `INSERT INTO secrets (
          secret_id,
          account_id,
          purpose,
          ciphertext,
          nonce,
          encryption_version,
          created_at,
          updated_at
        ) VALUES (
          @secretId,
          @accountId,
          @purpose,
          @ciphertext,
          @nonce,
          @encryptionVersion,
          @createdAt,
          @updatedAt
        )
        ON CONFLICT(secret_id) DO UPDATE SET
          ciphertext = excluded.ciphertext,
          nonce = excluded.nonce,
          encryption_version = excluded.encryption_version,
          updated_at = excluded.updated_at`,
      )
      .run(entity);
  }

  get(secretId: string): SecretEntity | null {
    const row = this.database.prepare('SELECT * FROM secrets WHERE secret_id = ?').get(secretId) as
      | Record<string, unknown>
      | undefined;

    return row ? mapRow(row) : null;
  }

  /** 是否存在指定 secretId 的密文（仅返回布尔存在性，不解密、不外泄任何密文内容）。 */
  exists(secretId: string): boolean {
    const row = this.database
      .prepare('SELECT 1 FROM secrets WHERE secret_id = ?')
      .get(secretId) as Record<string, unknown> | undefined;

    return row !== undefined;
  }

  /** 删除指定 secretId 的密文（按账户清理凭据引用时使用）。 */
  delete(secretId: string): void {
    this.database.prepare('DELETE FROM secrets WHERE secret_id = ?').run(secretId);
  }
}
