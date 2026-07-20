import type Database from 'better-sqlite3';

export interface AppLockConfigEntity {
  id: 'default';
  passwordDigest: string;
  kdfSalt: Buffer;
  kdfMemoryCost: number;
  kdfTimeCost: number;
  kdfParallelism: number;
  wrappedDekCiphertext: Buffer;
  wrappedDekNonce: Buffer;
  encryptionVersion: number;
  createdAt: string;
  updatedAt: string;
}

function mapRow(row: Record<string, unknown>): AppLockConfigEntity {
  return {
    id: 'default',
    passwordDigest: String(row.password_digest),
    kdfSalt: row.kdf_salt as Buffer,
    kdfMemoryCost: Number(row.kdf_memory_cost),
    kdfTimeCost: Number(row.kdf_time_cost),
    kdfParallelism: Number(row.kdf_parallelism),
    wrappedDekCiphertext: row.wrapped_dek_ciphertext as Buffer,
    wrappedDekNonce: row.wrapped_dek_nonce as Buffer,
    encryptionVersion: Number(row.encryption_version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class AppLockConfigRepository {
  constructor(private readonly database: Database.Database) {}

  get(): AppLockConfigEntity | null {
    const row = this.database.prepare('SELECT * FROM app_lock_config WHERE id = ?').get('default') as
      | Record<string, unknown>
      | undefined;

    return row ? mapRow(row) : null;
  }

  upsert(entity: AppLockConfigEntity): void {
    this.database
      .prepare(
        `INSERT INTO app_lock_config (
          id,
          password_digest,
          kdf_salt,
          kdf_memory_cost,
          kdf_time_cost,
          kdf_parallelism,
          wrapped_dek_ciphertext,
          wrapped_dek_nonce,
          encryption_version,
          created_at,
          updated_at
        ) VALUES (
          @id,
          @passwordDigest,
          @kdfSalt,
          @kdfMemoryCost,
          @kdfTimeCost,
          @kdfParallelism,
          @wrappedDekCiphertext,
          @wrappedDekNonce,
          @encryptionVersion,
          @createdAt,
          @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          password_digest = excluded.password_digest,
          kdf_salt = excluded.kdf_salt,
          kdf_memory_cost = excluded.kdf_memory_cost,
          kdf_time_cost = excluded.kdf_time_cost,
          kdf_parallelism = excluded.kdf_parallelism,
          wrapped_dek_ciphertext = excluded.wrapped_dek_ciphertext,
          wrapped_dek_nonce = excluded.wrapped_dek_nonce,
          encryption_version = excluded.encryption_version,
          updated_at = excluded.updated_at`,
      )
      .run(entity);
  }
}
