import type Database from 'better-sqlite3';
import type { Migration } from '../migration';

/**
 * 迁移 006：网络设置（Secure DNS 与 Proxy）。
 *
 * 新增单行 network_settings 表保存全局 Secure DNS 模式/DoH 服务器与 Proxy 模板；
 * 为 sites 与 auth_identities 增加 use_proxy 开关（默认关闭），使升级后所有既有
 * 站点与认证身份保持直连、流量出口不变。Secure DNS 为应用级（app.configureHostResolver），
 * Proxy 按 partition（Session.setProxy）逐资源生效，二者语义独立。
 */
export const networkSettingsMigration: Migration = {
  version: 6,
  name: 'network-settings',
  up(database: Database.Database): void {
    // 单行网络设置表：id 恒为 1，保证唯一 singleton；默认 automatic DNS + direct Proxy，
    // 等价于不施加任何特殊网络策略，避免升级改变现有出口。
    database.exec(`
      CREATE TABLE IF NOT EXISTS network_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        secure_dns_mode TEXT NOT NULL DEFAULT 'automatic',
        secure_dns_servers_json TEXT NOT NULL DEFAULT '[]',
        proxy_mode TEXT NOT NULL DEFAULT 'direct',
        fixed_proxy_scheme TEXT,
        fixed_proxy_host TEXT,
        fixed_proxy_port INTEGER,
        updated_at TEXT NOT NULL
      );
    `);

    const existing = database.prepare('SELECT id FROM network_settings WHERE id = 1').get();
    if (!existing) {
      database
        .prepare(
          `INSERT INTO network_settings (
            id, secure_dns_mode, secure_dns_servers_json, proxy_mode,
            fixed_proxy_scheme, fixed_proxy_host, fixed_proxy_port, updated_at
          ) VALUES (1, 'automatic', '[]', 'direct', NULL, NULL, NULL, @now)`,
        )
        .run({ now: new Date().toISOString() });
    }

    // 逐资源 Proxy opt-in 开关，默认 0（不使用代理），确保既有站点/身份升级后仍直连。
    addUseProxyColumn(database, 'sites');
    addUseProxyColumn(database, 'auth_identities');
  },
};

/** 幂等地为指定表补充 use_proxy 列；表名为固定字面量，非用户输入。 */
function addUseProxyColumn(database: Database.Database, table: 'sites' | 'auth_identities'): void {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some(column => column.name === 'use_proxy')) {
    database.exec(
      `ALTER TABLE ${table} ADD COLUMN use_proxy INTEGER NOT NULL DEFAULT 0 CHECK (use_proxy IN (0, 1));`,
    );
  }
}
