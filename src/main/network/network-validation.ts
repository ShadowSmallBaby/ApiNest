import { AppError } from '../../shared/ipc/errors';
import type {
  FixedProxyScheme,
  NetworkSettings,
  ProxyMode,
  ProxyTemplate,
  SecureDnsConfig,
  SecureDnsMode,
} from './network-types';

const SECURE_DNS_MODES: readonly SecureDnsMode[] = ['off', 'automatic', 'secure'];
const PROXY_MODES: readonly ProxyMode[] = ['direct', 'system', 'fixed'];
const FIXED_PROXY_SCHEMES: readonly FixedProxyScheme[] = ['http', 'https', 'socks5'];

const MAX_DOH_SERVERS = 8;
const MAX_HOST_LENGTH = 255;
const MIN_PORT = 1;
const MAX_PORT = 65535;

/** 扁平网络设置（贴合 network_settings 行 / IPC 输入），领域解析的输入形态。 */
export interface RawNetworkSettings {
  secureDnsMode: string;
  secureDnsServers: string[];
  proxyMode: string;
  fixedProxyScheme: string | null;
  fixedProxyHost: string | null;
  fixedProxyPort: number | null;
}

function isSecureDnsMode(value: string): value is SecureDnsMode {
  return (SECURE_DNS_MODES as readonly string[]).includes(value);
}

function isProxyMode(value: string): value is ProxyMode {
  return (PROXY_MODES as readonly string[]).includes(value);
}

function isFixedProxyScheme(value: string): value is FixedProxyScheme {
  return (FIXED_PROXY_SCHEMES as readonly string[]).includes(value);
}

/**
 * 校验单个 DoH 模板地址：必须 https、必须有 host、绝不含 userinfo / fragment。
 * 返回 trim 后的原串（不做 URL.toString 规范化，避免破坏 RFC8484 模板中的花括号）。
 */
export function normalizeDohServer(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new AppError('INVALID_ARGUMENT', 'DoH server URL must not be empty.');
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new AppError('INVALID_ARGUMENT', `DoH server URL is malformed: ${trimmed}`);
  }
  if (url.protocol !== 'https:') {
    throw new AppError('INVALID_ARGUMENT', 'DoH server URL must use https.');
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new AppError('INVALID_ARGUMENT', 'DoH server URL must not contain credentials.');
  }
  if (url.hash.length > 0) {
    throw new AppError('INVALID_ARGUMENT', 'DoH server URL must not contain a fragment.');
  }
  if (url.hostname.length === 0) {
    throw new AppError('INVALID_ARGUMENT', 'DoH server URL must contain a host.');
  }
  return trimmed;
}

/** 校验并返回规范化的代理主机名/IP：裸主机，绝不含 scheme/路径/认证/端口/分隔符。 */
export function normalizeProxyHost(raw: string): string {
  const host = raw.trim();
  if (host.length === 0) {
    throw new AppError('INVALID_ARGUMENT', 'Proxy host must not be empty.');
  }
  if (host.length > MAX_HOST_LENGTH) {
    throw new AppError('INVALID_ARGUMENT', 'Proxy host is too long.');
  }
  // 禁止空白、路径、认证、端口冒号、逗号/分号（proxyRules 分隔符）、query/fragment 与 scheme。
  // 冒号被禁止意味着不支持裸 IPv6 字面量（MVP 仅域名 / IPv4），避免破坏 host:port 语法。
  if (/[\s/@:,;?#]/.test(host) || host.includes('://')) {
    throw new AppError(
      'INVALID_ARGUMENT',
      'Proxy host must be a bare hostname or IPv4 address without scheme or port.',
    );
  }
  return host;
}

/** 校验代理端口：整数且落在 [1, 65535]。 */
export function normalizeProxyPort(raw: number): number {
  if (!Number.isInteger(raw) || raw < MIN_PORT || raw > MAX_PORT) {
    throw new AppError('INVALID_ARGUMENT', 'Proxy port must be an integer within [1, 65535].');
  }
  return raw;
}

function parseSecureDns(mode: string, servers: string[]): SecureDnsConfig {
  if (!isSecureDnsMode(mode)) {
    throw new AppError('INVALID_ARGUMENT', `Unknown secure DNS mode: ${mode}`);
  }
  if (mode !== 'secure') {
    // off / automatic 不携带自定义 DoH 服务器；清空以免残留脏数据。
    return { mode, servers: [] };
  }
  if (servers.length === 0) {
    throw new AppError('INVALID_ARGUMENT', 'Secure DNS mode requires at least one DoH server.');
  }
  if (servers.length > MAX_DOH_SERVERS) {
    throw new AppError('INVALID_ARGUMENT', `At most ${MAX_DOH_SERVERS} DoH servers are allowed.`);
  }
  const normalized = servers.map(normalizeDohServer);
  // 去重且保持首次出现顺序。
  const unique = Array.from(new Set(normalized));
  return { mode: 'secure', servers: unique };
}

function parseProxyTemplate(
  mode: string,
  scheme: string | null,
  host: string | null,
  port: number | null,
): ProxyTemplate {
  if (!isProxyMode(mode)) {
    throw new AppError('INVALID_ARGUMENT', `Unknown proxy mode: ${mode}`);
  }
  if (mode === 'direct') {
    return { mode: 'direct' };
  }
  if (mode === 'system') {
    return { mode: 'system' };
  }
  // fixed：三字段必须齐全且各自合法。
  if (scheme === null || host === null || port === null) {
    throw new AppError('INVALID_ARGUMENT', 'Fixed proxy requires scheme, host and port.');
  }
  if (!isFixedProxyScheme(scheme)) {
    throw new AppError('INVALID_ARGUMENT', `Unsupported proxy scheme: ${scheme}`);
  }
  return {
    mode: 'fixed',
    scheme,
    host: normalizeProxyHost(host),
    port: normalizeProxyPort(port),
  };
}

/**
 * 将扁平输入严格解析为领域 NetworkSettings；任何非法字段立即抛 AppError，
 * 绝不「宽松修复」或静默降级，确保写入/加载的配置始终是明确安全子集。
 */
export function parseNetworkSettings(raw: RawNetworkSettings): NetworkSettings {
  return {
    secureDns: parseSecureDns(raw.secureDnsMode, raw.secureDnsServers),
    proxy: parseProxyTemplate(
      raw.proxyMode,
      raw.fixedProxyScheme,
      raw.fixedProxyHost,
      raw.fixedProxyPort,
    ),
  };
}

/** 将领域 NetworkSettings 展平回持久层字段；fixed 之外的代理字段一律置空。 */
export function toRawNetworkSettings(settings: NetworkSettings): RawNetworkSettings {
  const { proxy, secureDns } = settings;
  return {
    secureDnsMode: secureDns.mode,
    secureDnsServers: secureDns.mode === 'secure' ? secureDns.servers : [],
    proxyMode: proxy.mode,
    fixedProxyScheme: proxy.mode === 'fixed' ? proxy.scheme : null,
    fixedProxyHost: proxy.mode === 'fixed' ? proxy.host : null,
    fixedProxyPort: proxy.mode === 'fixed' ? proxy.port : null,
  };
}
