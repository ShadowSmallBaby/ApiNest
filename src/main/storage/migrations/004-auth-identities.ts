import type { Migration } from '../migration';
import type Database from 'better-sqlite3';

/**
 * 迁移 004：auth 身份实体化（R13 演进）。
 *
 * 引入独立的 auth 身份实体，账户通过 auth_ref_id 引用它。并把现有绑账户的
 * 站点账密引用（secrets.purpose = 'site_login_credential'）迁移为 password 类型
 * 的 auth 身份，逐条零丢失搬运：
 *   - 为每个持有 site_login_credential 的账户创建一个 password 类型 auth 身份；
 *   - 将该密文的 purpose 改为 'auth_identity_credential'、secret_id 改为按 auth id 派生、
 *     account_id 改指向 auth id（保持 secrets 表 account_id 外键有效则需先解除该约束前提）；
 *   - 将账户 auth_ref_id 指向新建的 auth 身份。
 *
 * 说明：secrets.account_id 原有 FOREIGN KEY 指向 accounts(id)。为让凭据改绑 auth 身份，
 * 本迁移重建 secrets 表，去除该外键（凭据既可绑账户历史数据、也可绑 auth 身份），
 * 仅保留 secret_id 主键与业务语义，由服务层保证 account_id/purpose 的正确写入。
 */
export const authIdentitiesMigration: Migration = {
  version: 4,
  name: 'auth-identities',
  up(database: Database.Database): void {
    // 1) auth 身份表：不存任何凭据明文；password 类型的密文仍走 secrets 表。
    database.exec(`
      CREATE TABLE IF NOT EXISTS auth_identities (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    // 2) accounts 增加 auth_ref_id 列，引用一个 auth 身份（可空）。
    //    删除 auth 身份不级联删账户，只解除引用（ON DELETE SET NULL）。
    const accountColumns = database.prepare(`PRAGMA table_info(accounts)`).all() as Array<{
      name: string;
    }>;
    const hasAuthRef = accountColumns.some(column => column.name === 'auth_ref_id');
    if (!hasAuthRef) {
      database.exec(`
        ALTER TABLE accounts ADD COLUMN auth_ref_id TEXT
          REFERENCES auth_identities(id) ON DELETE SET NULL;
      `);
    }

    // 3) 重建 secrets 表以解除 account_id 对 accounts 的外键约束
    //    （凭据现在可绑 auth 身份而非仅账户）。保留全部现有数据。
    database.exec(`
      CREATE TABLE IF NOT EXISTS secrets_new (
        secret_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        purpose TEXT NOT NULL,
        ciphertext BLOB NOT NULL,
        nonce BLOB NOT NULL,
        encryption_version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO secrets_new SELECT
        secret_id, account_id, purpose, ciphertext, nonce, encryption_version, created_at, updated_at
      FROM secrets;
      DROP TABLE secrets;
      ALTER TABLE secrets_new RENAME TO secrets;
      CREATE INDEX IF NOT EXISTS idx_secrets_account_id ON secrets(account_id);
    `);

    // 4) 迁移现有站点账密引用为 password 类型 auth 身份，逐条零丢失搬运。
    const legacyCredentials = database
      .prepare(
        `SELECT s.secret_id AS secretId, s.account_id AS accountId, a.display_name AS displayName
         FROM secrets s
         LEFT JOIN accounts a ON a.id = s.account_id
         WHERE s.purpose = 'site_login_credential'`,
      )
      .all() as Array<{ secretId: string; accountId: string; displayName: string | null }>;

    const now = new Date().toISOString();
    const insertAuth = database.prepare(
      `INSERT INTO auth_identities (id, kind, label, note, created_at, updated_at)
       VALUES (@id, 'password', @label, NULL, @createdAt, @updatedAt)`,
    );
    const updateSecret = database.prepare(
      `UPDATE secrets SET secret_id = @newSecretId, account_id = @authId, purpose = 'auth_identity_credential'
       WHERE secret_id = @oldSecretId`,
    );
    const linkAccount = database.prepare(`UPDATE accounts SET auth_ref_id = @authId WHERE id = @accountId`);

    for (const legacy of legacyCredentials) {
      const authId = randomId();
      const label = legacy.displayName ? `${legacy.displayName} 的账号密码` : '站点账号密码';
      insertAuth.run({ id: authId, label, createdAt: now, updatedAt: now });
      updateSecret.run({
        newSecretId: `auth_identity_credential:${authId}`,
        authId,
        oldSecretId: legacy.secretId,
      });
      linkAccount.run({ authId, accountId: legacy.accountId });
    }
  },
};

/** 迁移内部用的 UUID 生成；与运行时 crypto.randomUUID 一致格式。 */
function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? fallbackUuid();
}

function fallbackUuid(): string {
  // 极少数无 WebCrypto 的环境降级；仅用于迁移期生成稳定 UUID。
  const hex = (n: number): string => Math.floor(n).toString(16).padStart(2, '0');
  const bytes = Array.from({ length: 16 }, () => hex(Math.random() * 256));
  bytes[6] = ((parseInt(bytes[6], 16) & 0x0f) | 0x40).toString(16).padStart(2, '0');
  bytes[8] = ((parseInt(bytes[8], 16) & 0x3f) | 0x80).toString(16).padStart(2, '0');
  return `${bytes.slice(0, 4).join('')}-${bytes.slice(4, 6).join('')}-${bytes.slice(6, 8).join('')}-${bytes.slice(8, 10).join('')}-${bytes.slice(10, 16).join('')}`;
}
