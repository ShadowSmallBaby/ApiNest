import type Database from 'better-sqlite3';
import type { PlatformType, SiteRouteProfile } from '../../../shared/ipc/bridge';

export interface SiteEntity {
  id: string;
  name: string;
  platform: PlatformType;
  baseUrl: string;
  note?: string;
  linuxDoClientId?: string;
  routeProfile: SiteRouteProfile;
  /** 是否让该站点账户的联网走全局 Proxy 模板；默认 false（直连）。 */
  useProxy: boolean;
  recordVersion: number;
  createdAt: string;
  updatedAt: string;
}

function mapSiteRow(row: Record<string, unknown>): SiteEntity {
  return {
    id: String(row.id),
    name: String(row.name),
    platform: String(row.platform) as PlatformType,
    baseUrl: String(row.base_url),
    note: row.note ? String(row.note) : undefined,
    linuxDoClientId: row.linuxdo_client_id ? String(row.linuxdo_client_id) : undefined,
    routeProfile: String(row.route_profile) as SiteRouteProfile,
    useProxy: Number(row.use_proxy) === 1,
    recordVersion: Number(row.record_version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class SiteRepository {
  constructor(private readonly database: Database.Database) {}

  create(entity: SiteEntity): void {
    this.database
      .prepare(
        `INSERT INTO sites (
          id, name, platform, base_url, note, linuxdo_client_id, route_profile,
          use_proxy, record_version, created_at, updated_at
        ) VALUES (
          @id, @name, @platform, @baseUrl, @note, @linuxDoClientId, @routeProfile,
          @useProxy, @recordVersion, @createdAt, @updatedAt
        )`,
      )
      .run({
        ...entity,
        note: entity.note ?? null,
        linuxDoClientId: entity.linuxDoClientId ?? null,
        useProxy: entity.useProxy ? 1 : 0,
      });
  }

  list(): SiteEntity[] {
    const rows = this.database.prepare('SELECT * FROM sites ORDER BY created_at ASC, id ASC').all();
    return rows.map(row => mapSiteRow(row as Record<string, unknown>));
  }

  get(id: string): SiteEntity | null {
    const row = this.database.prepare('SELECT * FROM sites WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? mapSiteRow(row) : null;
  }

  update(entity: SiteEntity): void {
    this.database
      .prepare(
        `UPDATE sites SET
          name = @name,
          platform = @platform,
          base_url = @baseUrl,
          note = @note,
          linuxdo_client_id = @linuxDoClientId,
          route_profile = @routeProfile,
          use_proxy = @useProxy,
          record_version = @recordVersion,
          updated_at = @updatedAt
        WHERE id = @id`,
      )
      .run({
        ...entity,
        note: entity.note ?? null,
        linuxDoClientId: entity.linuxDoClientId ?? null,
        useProxy: entity.useProxy ? 1 : 0,
      });
  }

  delete(id: string): void {
    this.database.prepare('DELETE FROM sites WHERE id = ?').run(id);
  }

  transaction<T>(operation: () => T): T {
    return this.database.transaction(operation)();
  }
}
