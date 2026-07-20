/**
 * 阶段 6 网络领域类型：Secure DNS 与 Proxy 的冻结配置模型。
 *
 * 这些类型是全应用网络策略的唯一真源，刻意与 Electron 运行时类型解耦：
 * - Secure DNS 为应用级（app.configureHostResolver），全局、重启生效；
 * - Proxy 为 partition 级模板（Session.setProxy），逐资源 opt-in。
 * 领域层只描述「允许的安全子集」，绝不表达 PAC / WPAD / 认证代理 / 任意 bypass。
 */

/** 全局 Secure DNS 模式：关闭 / 系统自动（含明文回退）/ 强制 DoH。 */
export type SecureDnsMode = 'off' | 'automatic' | 'secure';

/**
 * 全局 Secure DNS 配置。
 * servers 仅在 secure 模式下有意义且必须非空；每项为合法 https DoH 模板地址，
 * 绝不含 userinfo / fragment / 非 HTTPS scheme。
 */
export interface SecureDnsConfig {
  mode: SecureDnsMode;
  servers: string[];
}

/** 全局 Proxy 模板模式：直连 / 跟随系统 / 固定结构化代理。 */
export type ProxyMode = 'direct' | 'system' | 'fixed';

/** fixed 模式允许的代理协议（结构化，仅此三种）。 */
export type FixedProxyScheme = 'http' | 'https' | 'socks5';

/** 固定代理模板：结构化 scheme + host + port，绝不接受 raw proxyRules。 */
export interface FixedProxyTemplate {
  mode: 'fixed';
  scheme: FixedProxyScheme;
  host: string;
  port: number;
}

/** 全局 Proxy 模板（discriminated union）。 */
export type ProxyTemplate =
  | { mode: 'direct' }
  | { mode: 'system' }
  | FixedProxyTemplate;

/** 全局网络设置的领域视图（Secure DNS + Proxy 模板）。 */
export interface NetworkSettings {
  secureDns: SecureDnsConfig;
  proxy: ProxyTemplate;
}

/**
 * 编译后的代理配置：Electron ProxyConfig 的安全子集。
 * 只可能是 direct / system / fixed_servers，且 fixed_servers 的 proxyRules
 * 完全由结构化模板生成，Renderer 永远无法注入任意规则串。
 */
export type CompiledProxyMode = 'direct' | 'system' | 'fixed_servers';

export interface CompiledProxyConfig {
  mode: CompiledProxyMode;
  /** 仅 fixed_servers 存在；形如 `scheme://host:port`，作用于所有 URL scheme。 */
  proxyRules?: string;
}
