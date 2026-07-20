import { AppError } from '../../shared/ipc/errors';
import type { CompiledProxyConfig } from './network-types';
import type { NetworkSettingsService } from './network-settings-service';
import { compileProxyConfig } from './proxy-compiler';

/** account → siteId 的最小查询面（宽松兼容 siteId 为 undefined / null）。 */
export interface AccountProxyLookup {
  get(accountId: string): { siteId?: string | null } | null;
}

/** site → useProxy 的最小查询面。 */
export interface SiteProxyLookup {
  get(siteId: string): { useProxy: boolean } | null;
}

/** auth 身份 → useProxy 的最小查询面。 */
export interface AuthProxyLookup {
  get(authId: string): { useProxy: boolean } | null;
}

export interface NetworkPolicyResolverDependencies {
  accounts: AccountProxyLookup;
  sites: SiteProxyLookup;
  auths: AuthProxyLookup;
  settings: Pick<NetworkSettingsService, 'getSettings'>;
}

/**
 * 网络策略解析器：把「资源身份」翻译为该 partition 应使用的 CompiledProxyConfig。
 *
 * 调用方只能传 accountId / authId / 明确的 useProxy 布尔，绝不能传任意 partition 名
 * 或原始 proxyRules；是否走代理完全由资源自身的 opt-in 与全局模板共同决定。
 * opt-out（useProxy=false）一律编译为 direct，默认出口不变。
 */
export class NetworkPolicyResolver {
  constructor(private readonly deps: NetworkPolicyResolverDependencies) {}

  /** 账户 partition 的代理配置：由其所属 site.useProxy 与全局模板决定。 */
  resolveForAccount(accountId: string): CompiledProxyConfig {
    const account = this.deps.accounts.get(accountId);
    if (!account) {
      throw new AppError('ACCOUNT_NOT_FOUND', 'Account was not found.');
    }
    const useProxy = account.siteId
      ? (this.deps.sites.get(account.siteId)?.useProxy ?? false)
      : false;
    return this.resolveForFlag(useProxy);
  }

  /** auth 身份 partition 的代理配置：由其 useProxy 与全局模板决定。 */
  resolveForAuth(authId: string): CompiledProxyConfig {
    const auth = this.deps.auths.get(authId);
    if (!auth) {
      throw new AppError('NOT_FOUND', 'Auth identity was not found.');
    }
    return this.resolveForFlag(auth.useProxy);
  }

  /**
   * 直接由显式 useProxy 解析（探测场景：新 Site 尚未落库，用表单当前值），
   * 避免「先建站才能按策略探测」的先有鸡还是先有蛋问题。
   */
  resolveForFlag(useProxy: boolean): CompiledProxyConfig {
    return compileProxyConfig(useProxy, this.deps.settings.getSettings().proxy);
  }
}
