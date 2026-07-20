import type Database from 'better-sqlite3';

export type SnapshotKind = 'profile' | 'balance' | 'usage';

export interface SnapshotEntity {
  id: string;
  accountId: string;
  kind: SnapshotKind;
  payloadJson: string;
  semanticUnit?: string;
  fetchedAt: string;
  isLatest: boolean;
}

function mapRow(row: Record<string, unknown>): SnapshotEntity {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    kind: String(row.kind) as SnapshotKind,
    payloadJson: String(row.payload_json),
    semanticUnit: row.semantic_unit ? String(row.semantic_unit) : undefined,
    fetchedAt: String(row.fetched_at),
    isLatest: Number(row.is_latest) === 1,
  };
}

export class SnapshotRepository {
  constructor(private readonly database: Database.Database) {}

  /**
   * 写入某账户某类型的最新快照：先将该 accountId+kind 的旧记录 is_latest 置 0，
   * 再插入新的最新记录。使用事务保证只有一条 is_latest=1。
   */
  upsertLatest(entity: SnapshotEntity): void {
    const run = this.database.transaction((snapshot: SnapshotEntity) => {
      this.database
        .prepare(
          `UPDATE account_snapshots SET is_latest = 0
           WHERE account_id = @accountId AND kind = @kind AND is_latest = 1`,
        )
        .run({ accountId: snapshot.accountId, kind: snapshot.kind });

      this.database
        .prepare(
          `INSERT INTO account_snapshots (
            id,
            account_id,
            kind,
            payload_json,
            semantic_unit,
            fetched_at,
            is_latest
          ) VALUES (
            @id,
            @accountId,
            @kind,
            @payloadJson,
            @semanticUnit,
            @fetchedAt,
            1
          )`,
        )
        .run({
          id: snapshot.id,
          accountId: snapshot.accountId,
          kind: snapshot.kind,
          payloadJson: snapshot.payloadJson,
          semanticUnit: snapshot.semanticUnit ?? null,
          fetchedAt: snapshot.fetchedAt,
        });
    });

    run(entity);
  }

  /** 取该账户各 kind 的最新一条快照。 */
  getLatest(accountId: string): SnapshotEntity[] {
    const rows = this.database
      .prepare(
        'SELECT * FROM account_snapshots WHERE account_id = ? AND is_latest = 1 ORDER BY kind ASC',
      )
      .all(accountId) as Array<Record<string, unknown>>;

    return rows.map(mapRow);
  }
}
