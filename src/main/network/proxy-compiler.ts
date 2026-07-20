import type { CompiledProxyConfig, FixedProxyTemplate, ProxyTemplate } from './network-types';

/**
 * 由结构化固定代理模板生成 proxyRules。
 *
 * 不带 `urlScheme=` 前缀的单个 proxyURL 会作用于所有 URL scheme（http/https/ws/...），
 * 满足「该资源全部流量走同一固定代理」的语义：
 * - http  → `http://host:port`（普通 HTTP 代理）
 * - https → `https://host:port`（TLS 加密的 HTTPS 代理）
 * - socks5→ `socks5://host:port`（SOCKS5 代理）
 * host/port 已在校验层规范化，绝不含空白、分隔符或注入 proxyRules 语法的字符。
 */
export function buildProxyRules(template: FixedProxyTemplate): string {
  return `${template.scheme}://${template.host}:${template.port}`;
}

/**
 * 将「是否 opt-in + 全局 Proxy 模板」编译为 Electron ProxyConfig 的安全子集。
 *
 * - useProxy=false：一律强制 `direct`，等价于不使用任何代理（默认出口不变）。
 * - useProxy=true：应用全局模板（direct / system / fixed_servers）。
 * 绝不产生 pac_script / auto_detect / proxyBypassRules —— 领域层根本不表达这些能力。
 */
export function compileProxyConfig(useProxy: boolean, template: ProxyTemplate): CompiledProxyConfig {
  if (!useProxy) {
    return { mode: 'direct' };
  }
  switch (template.mode) {
    case 'direct':
      return { mode: 'direct' };
    case 'system':
      return { mode: 'system' };
    case 'fixed':
      return { mode: 'fixed_servers', proxyRules: buildProxyRules(template) };
    default: {
      // 穷尽保护：discriminated union 已覆盖全部分支，未知模式属于类型不可达。
      const exhaustive: never = template;
      throw new Error(`Unsupported proxy template mode: ${String(exhaustive)}`);
    }
  }
}
