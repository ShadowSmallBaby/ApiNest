import type Database from 'better-sqlite3';

/**
 * 网络设置实体（单行 network_settings 的行映射）。
 * 采用扁平字段贴合表结构；DoH 服务器数组只在本仓储边界做 JSON 编解码。
 */
export interface NetworkSettingsEntity {
  secureDnsMode: string;
  secureDnsServers: string[];
  proxyMode: string;
  fixedProxyScheme: string | null;
  fixedProxyHost: string | null;
  fixedProxyPort: number | null;
  updatedAt: string;
}

function parseServers(value: unknown): string[] {
  if (typeof value !== 'string') {
    throw new Error('network_settings.secure_dns_servers_json is not a string.');
  }
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string')) {
    throw new Error('network_settings.secure_dns_servers_json is malformed.');
  }
  return parsed as string[];
}

function mapRow(row: Record<string, unknown>): NetworkSettingsEntity {
  return {
    secureDnsMode: String(row.secure_dns_mode),
    secureDnsServers: parseServers(row.secure_dns_servers_json),
    proxyMode: String(row.proxy_mode),
    fixedProxyScheme: row.fixed_proxy_scheme != null ? String(row.fixed_proxy_scheme) : null,
    fixedProxyHost: row.fixed_proxy_host != null ? String(row.fixed_proxy_host) : null,
    fixedProxyPort: row.fixed_proxy_port != null ? Number(row.fixed_proxy_port) : null,
    updatedAt: String(row.updated_at),
  };
}

/**
 * 网络设置仓储：只读写单行 singleton（id=1）。
 * singleton 缺失或 JSON 损坏时明确抛错，绝不静默生成一份新的默认配置，
 * 避免在数据异常时悄悄改变全局网络出口。
 */
export class NetworkSettingsRepository {
  constructor(private readonly database: Database.Database) {}

  get(): NetworkSettingsEntity {
    const row = this.database.prepare('SELECT * FROM network_settings WHERE id = 1').get() as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      throw new Error('network_settings singleton row is missing.');
    }
    return mapRow(row);
  }

  update(entity: NetworkSettingsEntity): void {
    this.database
      .prepare(
        `UPDATE network_settings SET
          secure_dns_mode = @secureDnsMode,
          secure_dns_servers_json = @secureDnsServersJson,
          proxy_mode = @proxyMode,
          fixed_proxy_scheme = @fixedProxyScheme,
          fixed_proxy_host = @fixedProxyHost,
          fixed_proxy_port = @fixedProxyPort,
          updated_at = @updatedAt
        WHERE id = 1`,
      )
      .run({
        secureDnsMode: entity.secureDnsMode,
        secureDnsServersJson: JSON.stringify(entity.secureDnsServers),
        proxyMode: entity.proxyMode,
        fixedProxyScheme: entity.fixedProxyScheme ?? null,
        fixedProxyHost: entity.fixedProxyHost ?? null,
        fixedProxyPort: entity.fixedProxyPort ?? null,
        updatedAt: entity.updatedAt,
      });
  }
}
