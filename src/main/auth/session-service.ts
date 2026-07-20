/**
 * 账户网页会话清理接口。
 *
 * 抽象出 Electron session 的清理能力，便于在测试中注入替身，
 * 也让账户删除 / 清会话事务不直接依赖 Electron 运行时。
 */
export interface AccountSessionCleaner {
  /** 清理该账户 partition 的 Cookie、缓存与网页存储；不影响其他账户。 */
  clearAccountSession(accountId: string): Promise<void>;
}

/** Electron `Cookies.get` 返回项中本项目实际使用到的最小子集。 */
export interface CookieLike {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  expirationDate?: number;
  sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict';
}

/** Electron `Cookies.set` 入参中本项目实际使用到的最小子集。 */
export interface CookiesSetDetailsLike {
  url: string;
  name?: string;
  value?: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  expirationDate?: number;
  sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict';
}

/** Electron `Session.cookies` 中本项目实际使用到的最小子集。 */
export interface ElectronCookiesLike {
  get(filter: Record<string, unknown>): Promise<CookieLike[]>;
  set(details: CookiesSetDetailsLike): Promise<void>;
}

/** Electron `ProxyConfig` 中本项目实际设置到的最小子集（direct/system/fixed_servers）。 */
export interface ProxyConfigLike {
  mode?: string;
  proxyRules?: string;
}

/** Electron `Session` 中本项目实际使用到的最小子集。 */
export interface ElectronSessionLike {
  clearStorageData(): Promise<void>;
  clearCache(): Promise<void>;
  cookies: ElectronCookiesLike;
  /** 应用代理配置（阶段 6）；参数为 Electron ProxyConfig 的最小子集。 */
  setProxy(config: ProxyConfigLike): Promise<void>;
  /** 关闭该 partition 所有在途连接，避免旧代理 socket 被连接池复用（阶段 6）。 */
  closeAllConnections(): Promise<void>;
}

/** Electron `session` 模块中本项目实际使用到的最小子集。 */
export interface SessionModuleLike {
  fromPartition(partition: string): ElectronSessionLike;
}
