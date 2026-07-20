import type { NetworkSettingsView } from '../../shared/ipc/bridge';
import type { NetworkSettings } from './network-types';
import type { RawNetworkSettings } from './network-validation';

/**
 * 领域 NetworkSettings ↔ IPC NetworkSettingsView 的边界转换。
 *
 * 领域层 SecureDnsConfig 始终携带 servers（off/automatic 为 []），而 View 用 discriminated
 * union（off/automatic 不含 servers），故需在此显式收窄，避免把空 servers 泄露进视图。
 */
export function toNetworkSettingsView(settings: NetworkSettings): NetworkSettingsView {
  const secureDns =
    settings.secureDns.mode === 'secure'
      ? { mode: 'secure' as const, servers: settings.secureDns.servers }
      : { mode: settings.secureDns.mode };
  const proxy =
    settings.proxy.mode === 'fixed'
      ? {
          mode: 'fixed' as const,
          scheme: settings.proxy.scheme,
          host: settings.proxy.host,
          port: settings.proxy.port,
        }
      : { mode: settings.proxy.mode };
  return { secureDns, proxy };
}

/** 将 IPC 视图（已通过严格 schema）展平为持久层输入；secure/fixed 之外字段一律置空。 */
export function rawFromNetworkSettingsView(view: NetworkSettingsView): RawNetworkSettings {
  return {
    secureDnsMode: view.secureDns.mode,
    secureDnsServers: view.secureDns.mode === 'secure' ? view.secureDns.servers : [],
    proxyMode: view.proxy.mode,
    fixedProxyScheme: view.proxy.mode === 'fixed' ? view.proxy.scheme : null,
    fixedProxyHost: view.proxy.mode === 'fixed' ? view.proxy.host : null,
    fixedProxyPort: view.proxy.mode === 'fixed' ? view.proxy.port : null,
  };
}
