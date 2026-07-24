import type { NetworkSettingsView } from '../../shared/ipc/bridge';
import type { NetworkSettings } from './network-types';
import type { RawNetworkSettings } from './network-validation';

/**
 * 领域 NetworkSettings ↔ IPC NetworkSettingsView 的边界转换。
 *
 * servers 始终回传（含 off/automatic），关闭开关不丢已填 DoH。
 */
export function toNetworkSettingsView(
  settings: NetworkSettings,
  extras?: { dnsApplied?: boolean; dnsApplyError?: string },
): NetworkSettingsView {
  const proxy =
    settings.proxy.mode === 'fixed'
      ? {
          mode: 'fixed' as const,
          scheme: settings.proxy.scheme,
          host: settings.proxy.host,
          port: settings.proxy.port,
        }
      : { mode: settings.proxy.mode };
  return {
    secureDns: {
      mode: settings.secureDns.mode,
      servers: settings.secureDns.servers,
    },
    proxy,
    ...(extras?.dnsApplied !== undefined ? { dnsApplied: extras.dnsApplied } : {}),
    ...(extras?.dnsApplyError ? { dnsApplyError: extras.dnsApplyError } : {}),
  };
}

/**
 * 将 IPC 视图展平为持久层输入。
 * off/automatic 也持久化 servers（配置保留）；mode 原样写入。
 */
export function rawFromNetworkSettingsView(view: NetworkSettingsView): RawNetworkSettings {
  return {
    secureDnsMode: view.secureDns.mode,
    secureDnsServers: view.secureDns.servers ?? [],
    proxyMode: view.proxy.mode,
    fixedProxyScheme: view.proxy.mode === 'fixed' ? view.proxy.scheme : null,
    fixedProxyHost: view.proxy.mode === 'fixed' ? view.proxy.host : null,
    fixedProxyPort: view.proxy.mode === 'fixed' ? view.proxy.port : null,
  };
}
