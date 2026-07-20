import type { ProxyTemplate, SecureDnsConfig, NetworkSettings } from './network-types';
import {
  parseNetworkSettings,
  toRawNetworkSettings,
  type RawNetworkSettings,
} from './network-validation';

/**
 * 网络设置仓储端口（最小面）；组合根用 NetworkSettingsRepository 适配，
 * 由适配层负责补 updatedAt 等持久元数据，使本服务与时间戳/存储细节解耦、可测。
 */
export interface NetworkSettingsStore {
  get(): RawNetworkSettings;
  update(raw: RawNetworkSettings): void;
}

/** 更新结果：新配置 + 相对旧配置的变化标记，供调用方决定重启提示 / Proxy 热应用。 */
export interface NetworkSettingsUpdate {
  settings: NetworkSettings;
  /** Secure DNS 发生变化（应用级、重启生效，本服务不热切换 Host Resolver）。 */
  dnsChanged: boolean;
  /** Proxy 模板发生变化（partition 级，调用方据此对已知 Session 热应用）。 */
  proxyChanged: boolean;
}

function secureDnsEquals(a: SecureDnsConfig, b: SecureDnsConfig): boolean {
  return (
    a.mode === b.mode &&
    a.servers.length === b.servers.length &&
    a.servers.every((server, index) => server === b.servers[index])
  );
}

function proxyEquals(a: ProxyTemplate, b: ProxyTemplate): boolean {
  if (a.mode !== b.mode) {
    return false;
  }
  if (a.mode === 'fixed' && b.mode === 'fixed') {
    return a.scheme === b.scheme && a.host === b.host && a.port === b.port;
  }
  return true;
}

/**
 * 网络设置领域服务：只负责读取、严格校验与保存全局 Secure DNS / Proxy 模板。
 *
 * 刻意不直接触碰 Session / Host Resolver：DNS 变化仅标记（重启生效），
 * Proxy 变化仅上报 proxyChanged，热应用编排交由更上层（组合根 / IPC 服务）完成，
 * 从而保持本服务纯净、可单测，且不越权改变运行时网络出口。
 */
export class NetworkSettingsService {
  constructor(private readonly store: NetworkSettingsStore) {}

  /** 读取并严格校验当前配置；数据损坏时向上抛错（绝不静默生成默认）。 */
  getSettings(): NetworkSettings {
    return parseNetworkSettings(this.store.get());
  }

  /**
   * 严格校验并保存新配置，返回相对旧配置的变化标记。
   * 校验失败直接抛错、绝不写库；写入的始终是规范化后的明确安全子集。
   */
  updateSettings(input: RawNetworkSettings): NetworkSettingsUpdate {
    const previous = this.getSettings();
    const next = parseNetworkSettings(input);
    this.store.update(toRawNetworkSettings(next));
    return {
      settings: next,
      dnsChanged: !secureDnsEquals(previous.secureDns, next.secureDns),
      proxyChanged: !proxyEquals(previous.proxy, next.proxy),
    };
  }
}
