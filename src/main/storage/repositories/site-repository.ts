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
  /** 站点启用开关；禁用站点默认从站点广场「仅启用」视图中隐藏。 */
  enabled: boolean;
  /** 站点标签（纯管理性元数据，用于展示与筛选）。 */
  tags: string[];
  /** 参与广场一键登录；默认 false。 */
  autoLogin: boolean;
  /** 参与广场一键 API 签到；与 checkInSiteUrl 互斥；默认 false。 */
  autoCheckIn: boolean;
  /** 额外签到站 URL；有值时签到改为打开该地址手动完成。 */
  checkInSiteUrl?: string;
  recordVersion: number;
  createdAt: string;
  updatedAt: string;
}

/** 健壮解析标签 JSON 文本：非法或非字符串数组一律降级为空数组，绝不抛出。 */
function parseTags(value: unknown): string[] {
  if (typeof value !== 'string' || value.length === 0) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
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
    enabled: Number(row.enabled) === 1,
    tags: parseTags(row.tags_json),
    autoLogin: Number(row.auto_login) === 1,
    autoCheckIn: Number(row.auto_checkin) === 1,
    checkInSiteUrl: row.check_in_site_url ? String(row.check_in_site_url) : undefined,
    recordVersion: Number(row.record_version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class SiteRepository {
  constructor(private readonly database: Database.Database) {}

  create(entity: SiteEntity): void {
    const { tags, enabled, useProxy, autoLogin, autoCheckIn, note, linuxDoClientId, checkInSiteUrl, ...rest } = entity;
    this.database
      .prepare(
        `INSERT INTO sites (
          id, name, platform, base_url, note, linuxdo_client_id, route_profile,
          use_proxy, enabled, tags_json, auto_login, auto_checkin, check_in_site_url,
          record_version, created_at, updated_at
        ) VALUES (
          @id, @name, @platform, @baseUrl, @note, @linuxDoClientId, @routeProfile,
          @useProxy, @enabled, @tagsJson, @autoLogin, @autoCheckIn, @checkInSiteUrl,
          @recordVersion, @createdAt, @updatedAt
        )`,
      )
      .run({
        ...rest,
        note: note ?? null,
        linuxDoClientId: linuxDoClientId ?? null,
        useProxy: useProxy ? 1 : 0,
        enabled: enabled ? 1 : 0,
        tagsJson: JSON.stringify(tags),
        autoLogin: autoLogin ? 1 : 0,
        autoCheckIn: autoCheckIn ? 1 : 0,
        checkInSiteUrl: checkInSiteUrl ?? null,
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
    const { tags, enabled, useProxy, autoLogin, autoCheckIn, note, linuxDoClientId, checkInSiteUrl, ...rest } = entity;
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
          enabled = @enabled,
          tags_json = @tagsJson,
          auto_login = @autoLogin,
          auto_checkin = @autoCheckIn,
          check_in_site_url = @checkInSiteUrl,
          record_version = @recordVersion,
          updated_at = @updatedAt
        WHERE id = @id`,
      )
      .run({
        ...rest,
        note: note ?? null,
        linuxDoClientId: linuxDoClientId ?? null,
        useProxy: useProxy ? 1 : 0,
        enabled: enabled ? 1 : 0,
        tagsJson: JSON.stringify(tags),
        autoLogin: autoLogin ? 1 : 0,
        autoCheckIn: autoCheckIn ? 1 : 0,
        checkInSiteUrl: checkInSiteUrl ?? null,
      });
  }

  delete(id: string): void {
    this.database.prepare('DELETE FROM sites WHERE id = ?').run(id);
  }

  transaction<T>(operation: () => T): T {
    return this.database.transaction(operation)();
  }
}
