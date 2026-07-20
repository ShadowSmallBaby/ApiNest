export type PlatformType = 'newapi' | 'sub2api' | 'cliproxyapi';
export type SiteRouteProfile = 'modern' | 'classic' | 'legacy-panel';
export type AuthState = 'unknown' | 'active' | 'expired' | 'error';
export type KnownPage = 'home' | 'userCenter' | 'usage' | 'token' | 'login';
export type LoginMode = 'manual' | 'linuxdo';

/** auth 身份类型：github/linuxdo 为分类标签，password 为可跨账户引用的账密凭据。 */
export type AuthKind = 'github' | 'linuxdo' | 'password';

/** auth 身份的非敏感视图（绝不含任何凭据明文）。 */
export interface AuthIdentity {
  id: string;
  kind: AuthKind;
  label: string;
  note?: string;
  /** password 类型是否已保存凭据；仅布尔存在性，绝不含内容。 */
  hasCredential: boolean;
  /** github/linuxdo 登录窗口是否走全局 Proxy 模板；password 类型不使用此项。 */
  useProxy: boolean;
}

export interface SiteRecord {
  id: string;
  name: string;
  platform: PlatformType;
  baseUrl: string;
  note?: string;
  linuxDoClientId?: string;
  routeProfile: SiteRouteProfile;
  /** 该站点账户联网是否走全局 Proxy 模板；默认 false（直连）。 */
  useProxy: boolean;
  accountCount: number;
}

export interface AccountRecord {
  id: string;
  siteId?: string;
  siteName?: string;
  platform: PlatformType;
  baseUrl: string;
  displayName: string;
  note?: string;
  linuxDoClientId?: string;
  routeProfile?: SiteRouteProfile;
  authState: AuthState;
  /** 关联的 auth 身份 ID；未关联时为 null。 */
  authRefId?: string | null;
}

export interface SiteMutationResult {
  site: SiteRecord;
  account: AccountRecord;
}

export interface SiteSyncResult {
  siteId: string;
  total: number;
  results: RefreshResult[];
}

export interface RefreshResult {
  accountId: string;
  authState: AuthState;
  message: string;
}

export interface LoginResult {
  accountId: string;
  mode: LoginMode;
  authState: AuthState;
  message: string;
}

export interface CheckInResult {
  accountId: string;
  result: 'success' | 'already_checked_in' | 'unsupported' | 'session_expired' | 'challenge_required' | 'failed' | 'cancelled';
  message: string;
}

export interface BatchCheckInResult {
  total: number;
  results: CheckInResult[];
}

export interface AuthStatus {
  initialized: boolean;
  unlocked: boolean;
}

/** 密钥（NewAPI token）的非敏感视图。key 字段始终脱敏，绝不含完整明文。 */
export interface ApiKeyRecord {
  /** 平台侧 token 数字 id（用于揭示明文时定位）。 */
  id: number;
  accountId: string;
  name: string;
  /** 脱敏后的 key 展示串（如 sk-…abcd），绝不是完整明文。 */
  maskedKey: string;
  /** 分组名（部分站点无此字段）。 */
  group?: string;
  /** 剩余额度（quota 语义原值）。 */
  remainQuota: number;
  /** 是否无限额度。 */
  unlimitedQuota: boolean;
  /** 已用额度（quota 语义原值）。 */
  usedQuota: number;
  /** 平台状态码原值（1=启用，其余为禁用/过期等，语义交由 UI 说明）。 */
  status: number;
  /** 创建时间（Unix 秒）。 */
  createdTime: number;
  /** 过期时间（Unix 秒；-1 表示永不过期）。 */
  expiredTime: number;
}

/** 模型（NewAPI pricing 行）的非敏感视图。 */
export interface ModelRecord {
  /** 模型名（唯一标识）。 */
  modelName: string;
  /** 计费类型：0=按量计费（token），1=按次计费。 */
  quotaType: number;
  /** 模型倍率（按量计费时的输入倍率）。 */
  modelRatio: number;
  /** 补全倍率（相对输入的输出倍率）。 */
  completionRatio: number;
  /** 按次计费价格（quotaType=1 时有意义）。 */
  modelPrice: number;
  /** 该模型可用的分组名列表。 */
  enableGroups: string[];
  /** 该模型支持的端点类型列表（如 chat/completions、messages 等）。 */
  supportedEndpointTypes: string[];
  /** 该模型是否在当前账户实际可用（与 /api/user/models 取交集得出）。 */
  availableForAccount: boolean;
}

/** NewAPI 日志类型：0=全部、1=充值、2=消费、3=管理、4=系统、5=错误、6=退款。 */
export type UsageLogType = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** 账户日志查询条件；页码从 1 开始，pageSize 最大 100。 */
export interface UsageLogQuery {
  page: number;
  pageSize: number;
  type?: UsageLogType;
  tokenName?: string;
  modelName?: string;
  startTimestamp?: number;
  endTimestamp?: number;
}

/**
 * NewAPI 日志的安全投影视图。
 * 不包含 username、IP、channel、content、other 或任何密钥明文。
 */
export interface UsageLogRecord {
  accountId: string;
  createdAt: number;
  type: UsageLogType;
  tokenId?: number;
  tokenName?: string;
  modelName?: string;
  quota?: number;
  promptTokens?: number;
  completionTokens?: number;
  useTime?: number;
  isStream?: boolean;
  group?: string;
}

/** 单账户日志分页结果；不跨账户合并分页。 */
export interface UsageLogPage {
  accountId: string;
  page: number;
  pageSize: number;
  total: number;
  items: UsageLogRecord[];
}

/** 阶段 4 文本类 API 测试仅允许固定端点枚举，禁止 Renderer 提交任意 URL/path。 */
export type TextApiEndpoint =
  | 'openai_chat_completions'
  | 'openai_responses'
  | 'anthropic_messages'
  | 'interactions'
  | 'google_generate_content';

export interface RunTextApiTestInput {
  accountId: string;
  tokenId: number;
  modelId: string;
  category: 'text';
  endpoint: TextApiEndpoint;
  message?: string;
  /** JSON object 字符串；空白表示使用端点内置请求体。 */
  customBodyJson?: string;
  /** 仅允许附加安全头；认证、Cookie、Host 等头由主进程控制或拒绝。 */
  customHeaders?: Record<string, string>;
}

/** 文本 API 测试的有界响应投影；不包含请求认证头、Cookie 或 partition。 */
export interface TextApiTestResult {
  accountId: string;
  tokenId: number;
  modelId: string;
  endpoint: TextApiEndpoint;
  status: number;
  ok: boolean;
  latencyMs: number;
  contentType?: string;
  requestId?: string;
  bodyText: string;
  truncated: boolean;
}

export type DetectionConfidence = 'high' | 'low' | 'unknown';

export interface PlatformDetectionResult {
  platform: PlatformType;
  confidence: DetectionConfidence;
  reason: string;
}

export interface AccountPageCapabilities {
  embeddedLogin: boolean;
  linuxDoOAuth: boolean;
  checkIn: boolean;
  pages: Partial<Record<KnownPage, true>>;
}

export type SnapshotKind = 'profile' | 'balance' | 'usage';

/** 账户某类型的最新非敏感快照（含时间与语义单位，供 UI 展示缓存数据与时间）。 */
export interface AccountSnapshot {
  kind: SnapshotKind;
  /** 结构化非敏感 payload 的 JSON 字符串（profile/balance/usage）。 */
  payloadJson: string;
  /** 语义单位（余额/用量为 quota 等），profile 可无。 */
  semanticUnit?: string;
  /** 数据获取时间（ISO）。 */
  fetchedAt: string;
}

export interface DashboardOperation {
  kind: string;
  status: 'success' | 'error';
  startedAt: string;
  errorCode?: string;
  errorSummary?: string;
}

export interface DashboardAccount {
  account: AccountRecord;
  snapshots: AccountSnapshot[];
  operations: DashboardOperation[];
}

export interface DashboardOverview {
  accounts: DashboardAccount[];
}

/** 全局网络设置的非敏感视图（Secure DNS + Proxy 模板）；绝不含认证代理凭据等敏感项。 */
export interface NetworkSettingsView {
  secureDns:
    | { mode: 'off' }
    | { mode: 'automatic' }
    | { mode: 'secure'; servers: string[] };
  proxy:
    | { mode: 'direct' }
    | { mode: 'system' }
    | { mode: 'fixed'; scheme: 'http' | 'https' | 'socks5'; host: string; port: number };
}

export interface ApiNestBridge {
  system: {
    version: string;
  };
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<boolean>;
    close(): Promise<void>;
    isMaximized(): Promise<boolean>;
    /** 订阅最大化状态变化，返回取消订阅函数。用于同步自绘按钮图标。 */
    onMaximizeChange(listener: (isMaximized: boolean) => void): () => void;
  };
  dashboard: {
    getOverview(): Promise<DashboardOverview>;
  };
  sites: {
    list(): Promise<SiteRecord[]>;
    get(id: string): Promise<SiteRecord>;
    create(input: import('./schemas').CreateSiteInput): Promise<SiteMutationResult>;
    update(id: string, input: import('./schemas').UpdateSiteInput): Promise<SiteRecord>;
    remove(id: string): Promise<void>;
    detectPlatform(baseUrl: string, useProxy?: boolean): Promise<PlatformDetectionResult>;
    addAccount(siteId: string, input: import('./schemas').CreateSiteAccountInput): Promise<AccountRecord>;
    syncAccounts(siteId: string): Promise<SiteSyncResult>;
    checkInAccounts(siteId: string): Promise<BatchCheckInResult>;
  };
  accounts: {
    list(): Promise<AccountRecord[]>;
    create(input: import('./schemas').CreateAccountInput): Promise<AccountRecord>;
    update(id: string, input: import('./schemas').UpdateAccountInput): Promise<AccountRecord>;
    copy(id: string): Promise<AccountRecord>;
    remove(id: string): Promise<void>;
    refresh(id: string): Promise<RefreshResult>;
    getCapabilities(id: string): Promise<AccountPageCapabilities>;
    getSnapshots(id: string): Promise<AccountSnapshot[]>;
    /** 关联/解除账户引用的 auth 身份（传 null 解除）。 */
    linkAuth(accountId: string, authId: string | null): Promise<AccountRecord>;
  };
  auth: {
    status(): Promise<AuthStatus>;
    unlock(masterPassword: string): Promise<void>;
    lock(): Promise<void>;
    openLogin(accountId: string, mode: LoginMode): Promise<LoginResult>;
    clearSession(accountId: string): Promise<void>;
  };
  authIdentities: {
    list(): Promise<AuthIdentity[]>;
    create(input: import('./schemas').CreateAuthIdentityInput): Promise<AuthIdentity>;
    update(id: string, input: Omit<import('./schemas').UpdateAuthIdentityInput, 'authId'>): Promise<AuthIdentity>;
    remove(id: string): Promise<void>;
    /** password 类型：保存/更新账密凭据；一次性输入立即加密，绝不回传明文。 */
    saveCredential(id: string, input: { username: string; password: string }): Promise<void>;
    /** password 类型：是否已保存凭据（仅布尔存在性）。 */
    hasCredential(id: string): Promise<boolean>;
    /** github/linuxdo 类型：打开独立 auth 窗口登录一次。 */
    openLogin(id: string): Promise<LoginResult>;
  };
  checkIn: {
    runOne(accountId: string): Promise<CheckInResult>;
    runAll(): Promise<BatchCheckInResult>;
  };
  keys: {
    /** 拉取账户的密钥列表（key 字段始终脱敏，绝不含完整明文）。 */
    listByAccount(accountId: string): Promise<ApiKeyRecord[]>;
    /** 揭示单个密钥的完整明文；仅当次返回，绝不写日志/快照/缓存。 */
    reveal(accountId: string, tokenId: number): Promise<string>;
  };
  models: {
    /** 拉取账户的模型列表（含计费与账户可用标注）。 */
    listByAccount(accountId: string): Promise<ModelRecord[]>;
  };
  logs: {
    /** 在线分页拉取单账户 NewAPI 日志的安全投影视图。 */
    listByAccount(accountId: string, query: UsageLogQuery): Promise<UsageLogPage>;
  };
  apiTest: {
    /** 主进程发起一次非流式文本 API 测试；完整密钥不进入 Renderer。 */
    runText(input: RunTextApiTestInput): Promise<TextApiTestResult>;
  };
  network: {
    /** 读取全局 Secure DNS 与 Proxy 模板设置。 */
    getSettings(): Promise<NetworkSettingsView>;
    /** 更新全局网络设置；DNS 变更重启生效，Proxy 变更对已知 Session 热应用。 */
    updateSettings(input: import('./schemas').UpdateNetworkSettingsInput): Promise<NetworkSettingsView>;
  };
  pages: {
    openInApp(accountId: string, page: KnownPage): Promise<void>;
    openExternal(accountId: string, page: KnownPage): Promise<void>;
    /** 关闭当前内嵌视图（切换到非页面视图或用户主动关闭）。 */
    closeEmbedded(): Promise<void>;
    /** 上报内容区几何，使内嵌视图精确贴合内容区（Renderer 侧节流）。 */
    reportContentBounds(bounds: ViewBounds): Promise<void>;
    /**
     * 订阅内嵌页加载态（main→renderer）。
     * 仅转发结构化状态，不透传 Electron 事件；返回取消订阅函数。
     */
    onLoadStateChange(listener: (state: EmbeddedPageLoadState) => void): () => void;
  };
}

/** 内嵌页面视图的几何区域（视口内 CSS 像素，内容区相对窗口原点）。 */
export interface ViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 导航失败时的用户可读错误（不含敏感信息，可安全展示）。 */
export interface NavigationErrorView {
  code: number;
  description: string;
  url: string;
  title: string;
  message: string;
  tips: string[];
}

/**
 * 内嵌页加载态（main→renderer）。
 * loading：首屏/导航中；ready：主帧加载结束且成功；error：主帧失败，附排查提示。
 */
export type EmbeddedPageLoadState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'error'; error: NavigationErrorView };
