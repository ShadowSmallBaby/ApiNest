import type { AuthState, CheckInResult, KnownPage, PlatformType, SiteRouteProfile } from '../ipc/bridge';

/**
 * 平台适配器契约（能力驱动）。
 *
 * 业务层只依赖能力集，不直接判断平台类型。API 路径、字段映射、实例差异与
 * 站点原始错误文本只保留在适配器内部；API 调用失败绝不映射为零余额/零用量/已签到。
 */

/** 账户请求上下文：每次请求强制绑定 accountId 与独立 session，禁止共享 Cookie Jar。 */
export interface AccountRequestContext {
  accountId: string;
  baseUrl: string;
  platform: PlatformType;
  /** 账户专属持久 partition 名称（persist:apinest-account-<accountId>）。 */
  partition: string;
  /** NewAPI 站内数字用户 ID（New-Api-User 头必需）；缺失时受保护操作应判会话失效。 */
  siteUserId?: string;
}

/** 适配器可见能力集；UI 只渲染其声明为 true 的功能。 */
export interface CapabilitySet {
  embeddedLogin: boolean;
  linuxDoOAuth: boolean;
  profile: boolean;
  balance: boolean;
  usage: boolean;
  models: boolean;
  checkIn: boolean;
  pages: Partial<Record<KnownPage, true>>;
}

/** 平台探测置信度。 */
export type DetectionConfidence = 'high' | 'low' | 'unknown';

/** 平台探测结果；探测失败不等于创建失败，也不得据此将站点错误标注为可用。 */
export interface DetectionResult {
  platform: PlatformType;
  confidence: DetectionConfidence;
  reason: string;
}

/** 适配器统一错误模型；只暴露脱敏错误码与摘要，不含原始响应/URL Query/Cookie。 */
export type AdapterErrorCode =
  | 'UNSUPPORTED'
  | 'SESSION_INVALID'
  | 'SESSION_EXPIRED'
  | 'NETWORK_ERROR'
  | 'SITE_ERROR'
  | 'UNKNOWN';

export class AdapterError extends Error {
  constructor(
    public readonly code: AdapterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AdapterError';
  }
}

/** 账户元数据的适配器视图（不含敏感状态）。 */
export interface AdapterAccount {
  id: string;
  platform: PlatformType;
  baseUrl: string;
  displayName: string;
  linuxDoClientId?: string;
  /** 站点级 GitHub OAuth Client ID（来自 site_oauth_configs）。 */
  githubClientId?: string;
  routeProfile?: SiteRouteProfile;
}

export interface PlatformAdapter {
  readonly platform: PlatformType;

  detect(baseUrl: string, useProxy?: boolean): Promise<DetectionResult>;
  getCapabilities(account: AdapterAccount): Promise<CapabilitySet>;
  validateSession(context: AccountRequestContext): Promise<AuthState>;

  getPageUrl(account: AdapterAccount, page: KnownPage): URL | null;
  checkIn?(context: AccountRequestContext): Promise<CheckInResult>;
  getLinuxDoLoginUrl?(account: AdapterAccount): URL | null;
}

/** 完全不支持任何能力的空能力集（Sub2API/CPA 占位默认值）。 */
export const EMPTY_CAPABILITY_SET: CapabilitySet = {
  embeddedLogin: false,
  linuxDoOAuth: false,
  profile: false,
  balance: false,
  usage: false,
  models: false,
  checkIn: false,
  pages: {},
};
