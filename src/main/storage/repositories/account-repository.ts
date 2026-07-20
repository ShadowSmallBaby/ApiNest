import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { SiteRouteProfile } from '../../../shared/ipc/bridge';

export interface AccountEntity {
  id: string;
  siteId?: string;
  siteName?: string;
  platform: string;
  baseUrl: string;
  displayName: string;
  note?: string;
  linuxDoClientId?: string;
  routeProfile?: SiteRouteProfile;
  /** 关联的 auth 身份 ID；未关联时为 null。 */
  authRefId?: string | null;
  recordVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface NewAccountEntity {
  id: string;
  siteId: string;
  displayName: string;
  note?: string;
  authRefId?: string | null;
  recordVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface LegacyAccountEntity {
  id: string;
  platform: string;
  baseUrl: string;
  displayName: string;
  note?: string;
  linuxDoClientId?: string;
  authRefId?: string | null;
  recordVersion: number;
  createdAt: string;
  updatedAt: string;
}

export type AccountCreateEntity = NewAccountEntity | LegacyAccountEntity;

const ACCOUNT_SELECT = `
  SELECT
    a.id,
    a.site_id,
    s.name AS site_name,
    s.platform,
    s.base_url,
    a.display_name,
    a.note,
    s.linuxdo_client_id,
    s.route_profile,
    a.auth_ref_id,
    a.record_version,
    a.created_at,
    a.updated_at
  FROM accounts a
  INNER JOIN sites s ON s.id = a.site_id`;

function mapAccountRow(row: Record<string, unknown>): AccountEntity {
  return {
    id: String(row.id),
    siteId: String(row.site_id),
    siteName: String(row.site_name),
    platform: String(row.platform),
    baseUrl: String(row.base_url),
    displayName: String(row.display_name),
    note: row.note ? String(row.note) : undefined,
    linuxDoClientId: row.linuxdo_client_id ? String(row.linuxdo_client_id) : undefined,
    routeProfile: String(row.route_profile) as SiteRouteProfile,
    authRefId: row.auth_ref_id ? String(row.auth_ref_id) : null,
    recordVersion: Number(row.record_version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class AccountRepository {
  constructor(private readonly database: Database.Database) {}

  create(entity: AccountCreateEntity): void {
    const normalized = 'siteId' in entity ? entity : this.createLegacySite(entity);
    const result = this.database
      .prepare(
        `INSERT INTO accounts (
          id, platform, base_url, display_name, note, linuxdo_client_id,
          auth_ref_id, site_id, record_version, created_at, updated_at
        )
        SELECT
          @id, s.platform, s.base_url, @displayName, @note, s.linuxdo_client_id,
          @authRefId, s.id, @recordVersion, @createdAt, @updatedAt
        FROM sites s
        WHERE s.id = @siteId`,
      )
      .run({
        ...normalized,
        note: normalized.note ?? null,
        authRefId: normalized.authRefId ?? null,
      });

    if (result.changes !== 1) {
      throw new Error('Site was not found while creating account.');
    }
  }

  private createLegacySite(entity: LegacyAccountEntity): NewAccountEntity {
    const siteId = randomUUID();
    this.database
      .prepare(
        `INSERT INTO sites (
          id, name, platform, base_url, note, linuxdo_client_id, route_profile,
          record_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, NULL, ?, ?, 1, ?, ?)`,
      )
      .run(
        siteId,
        entity.displayName,
        entity.platform,
        entity.baseUrl,
        entity.linuxDoClientId ?? null,
        entity.platform === 'newapi' ? 'legacy-panel' : 'modern',
        entity.createdAt,
        entity.updatedAt,
      );
    return {
      id: entity.id,
      siteId,
      displayName: entity.displayName,
      note: entity.note,
      authRefId: entity.authRefId,
      recordVersion: entity.recordVersion,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  list(): AccountEntity[] {
    const rows = this.database
      .prepare(`${ACCOUNT_SELECT} ORDER BY a.created_at ASC, a.id ASC`)
      .all();
    return rows.map(row => mapAccountRow(row as Record<string, unknown>));
  }

  listBySite(siteId: string): AccountEntity[] {
    const rows = this.database
      .prepare(`${ACCOUNT_SELECT} WHERE a.site_id = ? ORDER BY a.created_at ASC, a.id ASC`)
      .all(siteId);
    return rows.map(row => mapAccountRow(row as Record<string, unknown>));
  }

  get(id: string): AccountEntity | null {
    const row = this.database
      .prepare(`${ACCOUNT_SELECT} WHERE a.id = ?`)
      .get(id) as Record<string, unknown> | undefined;

    return row ? mapAccountRow(row) : null;
  }

  update(entity: AccountEntity): void {
    this.database
      .prepare(
        `UPDATE accounts SET
          display_name = @displayName,
          note = @note,
          auth_ref_id = @authRefId,
          record_version = @recordVersion,
          updated_at = @updatedAt
        WHERE id = @id`,
      )
      .run({
        ...entity,
        note: entity.note ?? null,
        authRefId: entity.authRefId ?? null,
      });
  }

  delete(id: string): void {
    this.database.prepare('DELETE FROM accounts WHERE id = ?').run(id);
  }
}
