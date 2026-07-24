import { shell } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import {
  AppError,
  SerializedAppError,
} from '../../shared/ipc/errors';
import {
  authStatusInputSchema,
  clearSessionInputSchema,
  closeEmbeddedInputSchema,
  contentBoundsInputSchema,
  copyAccountInputSchema,
  createAccountInputSchema,
  dashboardOverviewInputSchema,
  detectPlatformInputSchema,
  getCapabilitiesInputSchema,
  getSnapshotsInputSchema,
  lockInputSchema,
  openKnownPageInputSchema,
  openLoginInputSchema,
  importCookiesInputSchema,
  refreshAccountInputSchema,
  removeAccountInputSchema,
  runAllCheckInInputSchema,
  runOneCheckInInputSchema,
  unlockInputSchema,
  updateAccountInputSchema,
  windowCommandInputSchema,
  authIdentitiesListInputSchema,
  authIdentityIdInputSchema,
  openAuthIdentityLoginInputSchema,
  createAuthIdentityInputSchema,
  updateAuthIdentityInputSchema,
  saveAuthCredentialInputSchema,
  linkAccountAuthInputSchema,
  addSiteAccountInputSchema,
  createSiteInputSchema,
  siteIdInputSchema,
  sitesListInputSchema,
  sitesBatchLoginInputSchema,
  sitesBatchCheckInInputSchema,
  updateSiteRequestSchema,
  listKeysByAccountInputSchema,
  refreshKeysByAccountInputSchema,
  revealKeyInputSchema,
  captureKeysByAccountInputSchema,
  listModelsInputSchema,
  listLogsByAccountInputSchema,
  runTextApiTestInputSchema,
  getNetworkSettingsInputSchema,
  updateNetworkSettingsInputSchema,
  getOAuthConfigsInputSchema,
  upsertOAuthConfigInputSchema,
  deleteOAuthConfigInputSchema,
} from '../../shared/ipc/schemas';
import type { AccountService } from '../accounts/account-service';
import { AdapterRegistry } from '../adapters/adapter-registry';
import type { AdapterAccount } from '../../shared/domain/platform-adapter';
import type { RefreshService } from '../refresh/refresh-service';
import type { LockService } from '../security/lock-service';
import type { CheckInService } from '../checkin/checkin-service';
import type { BatchCheckInOrchestrator } from '../checkin/batch-checkin-orchestrator';
import type { DashboardService } from '../dashboard/dashboard-service';
import type { LoginFlowService } from '../auth/login-flow-service';
import type { BatchLoginOrchestrator } from '../auth/batch-login-orchestrator';
import type { SnapshotRepository } from '../storage/repositories/snapshot-repository';
import type { SiteService } from '../sites/site-service';
import {
  resolveSiteOAuthProviders,
  selectBatchCheckInAccountIds,
  selectBatchLoginAccountIds,
} from '../sites/batch-eligibility';
import type { SiteOAuthConfigRepository } from '../storage/site-oauth-config-repository';
import type { CheckInResultRepository } from '../storage/repositories/checkin-result-repository';
import type { AuthIdentityRepository } from '../storage/repositories/auth-identity-repository';

import type {
  AccountPageCapabilities,
  AccountRecord,
  AccountSnapshot,
  ApiKeyRecord,
  CaptureKeysResult,
  ModelRecord,
  UsageLogPage,
  UsageLogQuery,
  RunTextApiTestInput,
  TextApiTestResult,
  AuthIdentity,
  AuthKind,
  AuthLoginTarget,
  AuthState,
  AuthStatus,
  BatchLoginResult,
  KnownPage,
  LoginResult,
  RefreshResult,
  SiteRecord,
  NetworkSettingsView,
} from '../../shared/ipc/bridge';

type IpcLockService = Pick<
  LockService,
  'isInitialized' | 'isUnlocked' | 'initialize' | 'unlock' | 'lock' | 'assertUnlocked'
>;

type IpcAccountService = Omit<Pick<
  AccountService,
  'list' | 'listBySite' | 'update' | 'copy' | 'remove' | 'clearSession' | 'linkAuth'
>, 'update'> & {
  create(input: import('../../shared/ipc/schemas').CreateAccountInput): AccountRecord;
  update(id: string, input: import('../../shared/ipc/schemas').UpdateAccountInput): AccountRecord;
};
type IpcSiteService = Pick<SiteService, 'list' | 'get' | 'create' | 'update' | 'detectPlatform' | 'addAccount' | 'remove' | 'getSummaries'>;

type IpcAdapterRegistry = Pick<AdapterRegistry, 'get'>;

type IpcRefreshService = Pick<RefreshService, 'refresh'>;

type IpcSnapshotRepository = Pick<SnapshotRepository, 'getLatest'>;
type IpcCheckInService = Pick<CheckInService, 'run'>;
type IpcBatchCheckInOrchestrator = Pick<BatchCheckInOrchestrator, 'run'>;
type IpcBatchLoginOrchestrator = Pick<BatchLoginOrchestrator, 'run'>;
type IpcDashboardService = Pick<DashboardService, 'getOverview'>;
type IpcLoginFlowService = Pick<LoginFlowService, 'open'>;
type IpcCheckInResultRepository = Pick<CheckInResultRepository, 'listCheckedInAccountIdsToday'>;
type IpcAuthIdentityRepository = Pick<AuthIdentityRepository, 'get'>;

/** 手动 Cookie 导入端口（主进程写账户 partition）。 */
export interface CookieImportPort {
  import(
    accountId: string,
    cookieHeader: string,
  ): Promise<{ imported: number; authState: AuthState; message: string }>;
}

/** 窗口控制端口：仅固定枚举动作，不接受任意句柄/坐标/尺寸。 */
export interface WindowControlPort {
  minimize(): void;
  toggleMaximize(): boolean;
  close(): void;
  isMaximized(): boolean;
}

/** 内容区几何（非负整数像素），用于内嵌视图定位。 */
export interface ContentBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 应用内打开已知页面的最小请求（仅含定位所需字段，不含任何凭据）。 */
export interface InAppPageRequest {
  accountId: string;
  baseUrl: string;
  url: string;
  /** 内容区几何；接线层据此定位内嵌视图，缺省时用最近上报值。 */
  bounds?: ContentBounds;
}

/** 应用内打开已知页面的端口；真实容器在组合根接线，测试可注入假实现。 */
export type InAppPageOpener = (request: InAppPageRequest) => void | Promise<void>;

/** 内嵌页面视图控制端口；close/reportBounds 供接线层管理单例视图。 */
export interface EmbeddedPagePort {
  close(): void;
  reportBounds(bounds: ContentBounds): void;
}

/** 窗口控制端口；只暴露固定枚举动作，真实实现在组合根接线，测试可注入假实现。 */
export interface WindowControlPort {
  minimize(): void;
  toggleMaximize(): boolean;
  close(): void;
  isMaximized(): boolean;
}

/**
 * auth 身份端口（R13 演进）；封装身份 CRUD、password 凭据存/存在性与身份登录。
 * 真实实现在组合根接线，测试可注入假实现。saveCredential 只接收一次性输入，
 * 立即加密落盘；端口绝不提供任何回传账密明文的通道。
 */
export interface AuthIdentitiesPort {
  list(): AuthIdentity[];
  create(input: { kind: AuthKind; label: string; note?: string; useProxy?: boolean }): AuthIdentity;
  update(authId: string, input: { label?: string; note?: string; useProxy?: boolean }): AuthIdentity;
  remove(authId: string): void;
  saveCredential(authId: string, input: { username: string; password: string }): void;
  hasCredential(authId: string): boolean;
  openLogin(authId: string, target?: AuthLoginTarget): LoginResult | Promise<LoginResult>;
}

/**
 * 密钥端口（阶段 1）；封装按账户拉取密钥列表与揭示单个密钥明文。
 * 真实实现在组合根接线，测试可注入假实现。
 * listByAccount 返回的 key 字段始终脱敏；reveal 明文仅当次返回，绝不写日志/快照/缓存。
 */
export interface KeysPort {
  listByAccount(accountId: string): Promise<ApiKeyRecord[]>;
  refresh(accountId: string): Promise<ApiKeyRecord[]>;
  reveal(accountId: string, tokenId: number): Promise<string>;
  captureAll(accountId: string): Promise<CaptureKeysResult>;
}

/**
 * 模型端口（阶段 2）；封装按账户拉取模型定价与账户可用标注。
 * 真实实现在组合根接线，测试可注入假实现。
 */
export interface ModelsPort {
  listByAccount(accountId: string): Promise<ModelRecord[]>;
}

/** 日志端口（阶段 3）；在线分页拉取单账户 NewAPI 日志安全投影。 */
export interface LogsPort {
  listByAccount(accountId: string, query: UsageLogQuery): Promise<UsageLogPage>;
}

/** 文本 API 测试端口（阶段 4）；完整密钥仅在主进程服务内短暂使用。 */
export interface ApiTestPort {
  runText(input: RunTextApiTestInput): Promise<TextApiTestResult>;
}

/** 网络设置端口（阶段 6）：读取/更新全局 Secure DNS 与 Proxy 模板。真实实现在组合根接线。 */
export interface NetworkSettingsPort {
  getSettings(): NetworkSettingsView;
  updateSettings(input: NetworkSettingsView): NetworkSettingsView;
}

export interface IpcHandlerDependencies {
  lockService?: IpcLockService;
  accountService?: IpcAccountService;
  siteService?: IpcSiteService;
  siteOAuthConfigRepo?: SiteOAuthConfigRepository;
  adapterRegistry?: IpcAdapterRegistry;
  refreshService?: IpcRefreshService;
  snapshotRepository?: IpcSnapshotRepository;
  checkInService?: IpcCheckInService;
  batchCheckInOrchestrator?: IpcBatchCheckInOrchestrator;
  batchLoginOrchestrator?: IpcBatchLoginOrchestrator;
  checkInResultRepository?: IpcCheckInResultRepository;
  authIdentityRepository?: IpcAuthIdentityRepository;
  dashboardService?: IpcDashboardService;
  loginFlowService?: IpcLoginFlowService;
  cookieImport?: CookieImportPort;
  authIdentities?: AuthIdentitiesPort;
  keys?: KeysPort;
  models?: ModelsPort;
  logs?: LogsPort;
  apiTest?: ApiTestPort;
  network?: NetworkSettingsPort;
  inAppPageOpener?: InAppPageOpener;
  embeddedPage?: EmbeddedPagePort;
  windowControl?: WindowControlPort;
}

function createUnlockedLockService(): IpcLockService {
  return {
    isInitialized: () => true,
    isUnlocked: () => true,
    initialize: async () => {},
    unlock: async () => {},
    lock: () => {},
    assertUnlocked: () => {},
  };
}

function createInMemoryServices(): { accountService: IpcAccountService; siteService: IpcSiteService } {
  const sites = new Map<string, SiteRecord>();
  const accounts = new Map<string, AccountRecord>();
  let nextId = 1;
  const newId = (): string => `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`;

  const accountService: IpcAccountService = {
    list: () => Array.from(accounts.values()),
    listBySite: siteId => Array.from(accounts.values()).filter(account => account.siteId === siteId),
    create: input => {
      const site = sites.get(input.siteId);
      if (!site) {
        throw new AppError('NOT_FOUND', 'Site was not found.');
      }
      const account: AccountRecord = {
        id: newId(),
        siteId: site.id,
        siteName: site.name,
        platform: site.platform,
        baseUrl: site.baseUrl,
        displayName: input.displayName,
        note: input.note,
        linuxDoClientId: site.linuxDoClientId,
        routeProfile: site.routeProfile,
        authState: 'unknown',
        authRefId: input.authId ?? null,
      };
      accounts.set(account.id, account);
      sites.set(site.id, { ...site, accountCount: site.accountCount + 1 });
      return account;
    },
    update: (id, input) => {
      const current = accounts.get(id);
      if (!current) {
        throw new AppError('ACCOUNT_NOT_FOUND', 'Account was not found.');
      }
      const updated = { ...current, ...input };
      accounts.set(id, updated);
      return updated;
    },
    copy: id => {
      const current = accounts.get(id);
      if (!current) {
        throw new AppError('ACCOUNT_NOT_FOUND', 'Account was not found.');
      }
      const copied = { ...current, id: newId(), displayName: `${current.displayName} Copy`, authState: 'unknown' as const, authRefId: null };
      accounts.set(copied.id, copied);
      const site = sites.get(current.siteId!);
      if (site) sites.set(site.id, { ...site, accountCount: site.accountCount + 1 });
      return copied;
    },
    remove: async id => {
      const account = accounts.get(id);
      if (!account) throw new AppError('ACCOUNT_NOT_FOUND', 'Account was not found.');
      accounts.delete(id);
      const site = sites.get(account.siteId!);
      if (site) sites.set(site.id, { ...site, accountCount: Math.max(0, site.accountCount - 1) });
    },
    clearSession: async id => {
      if (!accounts.has(id)) throw new AppError('ACCOUNT_NOT_FOUND', 'Account was not found.');
    },
    linkAuth: (id, authId) => {
      const current = accounts.get(id);
      if (!current) throw new AppError('ACCOUNT_NOT_FOUND', 'Account was not found.');
      const updated = { ...current, authRefId: authId };
      accounts.set(id, updated);
      return updated;
    },
  };

  const siteService: IpcSiteService = {
    list: () => Array.from(sites.values()),
    detectPlatform: async baseUrl => ({
      platform: 'newapi',
      confidence: 'unknown',
      reason: `Detection is unavailable for ${baseUrl}.`,
    }),
    get: id => {
      const site = sites.get(id);
      if (!site) throw new AppError('NOT_FOUND', 'Site was not found.');
      return site;
    },
    create: input => {
      const site: SiteRecord = {
        id: newId(), name: input.name, platform: input.platform, baseUrl: input.baseUrl,
        note: input.note, linuxDoClientId: input.linuxDoClientId,
        routeProfile: input.platform === 'newapi' ? input.routeProfile : 'modern',
        useProxy: input.useProxy ?? false,
        enabled: input.enabled ?? true, tags: input.tags ?? [],
        autoLogin: input.autoLogin ?? false,
        autoCheckIn: input.checkInSiteUrl?.trim() ? false : (input.autoCheckIn ?? false),
        checkInSiteUrl: input.checkInSiteUrl?.trim() || undefined,
        accountCount: 0,
      };
      sites.set(site.id, site);
      const account = accountService.create({ siteId: site.id, ...input.firstAccount });
      return { site: sites.get(site.id)!, account };
    },
    update: (id, input) => {
      const current = sites.get(id);
      if (!current) throw new AppError('NOT_FOUND', 'Site was not found.');
      const updated = { ...current, ...input };
      sites.set(id, updated);
      for (const [accountId, account] of accounts) {
        if (account.siteId === id) {
          accounts.set(accountId, {
            ...account, siteName: updated.name, platform: updated.platform, baseUrl: updated.baseUrl,
            linuxDoClientId: updated.linuxDoClientId, routeProfile: updated.routeProfile,
          });
        }
      }
      return updated;
    },
    addAccount: (siteId, input) => accountService.create({ siteId, ...input }),
    remove: async id => {
      if (!sites.has(id)) throw new AppError('NOT_FOUND', 'Site was not found.');
      for (const [accountId, account] of accounts) if (account.siteId === id) accounts.delete(accountId);
      sites.delete(id);
    },
    // 无 DB 模式无快照/签到数据：余额合计一律 null（红线不伪造 0），今日签到数 0。
    getSummaries: () =>
      Array.from(sites.values()).map(site => ({
        siteId: site.id,
        balanceTotal: null,
        checkedInToday: 0,
      })),
  };

  return { accountService, siteService };
}

function createNotImplementedRefreshService(): IpcRefreshService {
  return {
    refresh: async (accountId: string): Promise<RefreshResult> => ({
      accountId,
      authState: 'unknown',
      message: 'Refresh is not implemented yet.',
    }),
  };
}

function getAuthStatus(lockService: IpcLockService): AuthStatus {
  return {
    initialized: lockService.isInitialized(),
    unlocked: lockService.isUnlocked(),
  };
}

function assertUnlockedForSensitiveOperation(lockService: IpcLockService): void {
  lockService.assertUnlocked();
}

function serializeError(error: unknown): SerializedAppError {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
    };
  }

  return {
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred.',
  };
}

async function safeHandle<T>(handler: () => Promise<T> | T): Promise<T> {
  try {
    return await handler();
  } catch (error) {
    throw serializeError(error);
  }
}

export function buildIpcHandlers(dependencies: IpcHandlerDependencies = {}) {
  const lockService = dependencies.lockService ?? createUnlockedLockService();
  const memoryServices = createInMemoryServices();
  const accountService = dependencies.accountService ?? memoryServices.accountService;
  const siteService = dependencies.siteService ?? memoryServices.siteService;
  const adapterRegistry = dependencies.adapterRegistry ?? new AdapterRegistry();
  const refreshService = dependencies.refreshService ?? createNotImplementedRefreshService();
  const snapshotRepository = dependencies.snapshotRepository;
  const checkInService = dependencies.checkInService;
  const batchCheckInOrchestrator = dependencies.batchCheckInOrchestrator;
  const batchLoginOrchestrator = dependencies.batchLoginOrchestrator;
  const checkInResultRepository = dependencies.checkInResultRepository;
  const authIdentityRepository = dependencies.authIdentityRepository;
  const dashboardService = dependencies.dashboardService;
  const loginFlowService = dependencies.loginFlowService;
  const cookieImport = dependencies.cookieImport;
  const authIdentities = dependencies.authIdentities;
  const inAppPageOpener = dependencies.inAppPageOpener;
  const embeddedPage = dependencies.embeddedPage;
  const windowControl = dependencies.windowControl;
  const keys = dependencies.keys;
  const models = dependencies.models;
  const logs = dependencies.logs;
  const apiTest = dependencies.apiTest;
  const network = dependencies.network;

  const toAdapterAccount = (account: AccountRecord): AdapterAccount => ({
    id: account.id,
    platform: account.platform,
    baseUrl: account.baseUrl,
    displayName: account.displayName,
    linuxDoClientId: account.linuxDoClientId,
    routeProfile: account.routeProfile,
  });

  // 将账户 + 已知页面解析为真实 URL。账户不存在→ACCOUNT_NOT_FOUND；
  // 页面路径未经确认（适配器返回 null）→INVALID_ARGUMENT，绝不打开臆造地址。
  const resolveKnownPageUrl = (
    accountId: string,
    page: KnownPage,
  ): { account: AccountRecord; url: URL } => {
    const account = accountService.list().find(item => item.id === accountId);
    if (!account) {
      throw new AppError('ACCOUNT_NOT_FOUND', 'Account was not found.');
    }

    const adapterAccount = toAdapterAccount(account);
    const url = adapterRegistry.get(account.platform).getPageUrl(adapterAccount, page);
    if (!url) {
      throw new AppError('INVALID_ARGUMENT', 'This page is not available for the account platform.');
    }

    return { account, url };
  };

  return {
    [IPC_CHANNELS.dashboard.getOverview]: (payload?: unknown) =>
      safeHandle(() => {
        assertUnlockedForSensitiveOperation(lockService);
        dashboardOverviewInputSchema.parse(payload ?? {});
        if (!dashboardService) {
          throw new AppError('NOT_IMPLEMENTED', 'Dashboard is not available.');
        }
        return dashboardService.getOverview();
      }),
    [IPC_CHANNELS.sites.list]: (payload?: unknown) =>
      safeHandle(() => {
        assertUnlockedForSensitiveOperation(lockService);
        sitesListInputSchema.parse(payload ?? {});
        return siteService.list();
      }),
    [IPC_CHANNELS.sites.get]: (payload: unknown) =>
      safeHandle(() => {
        assertUnlockedForSensitiveOperation(lockService);
        const parsed = siteIdInputSchema.parse(payload);
        return siteService.get(parsed.siteId);
      }),
    [IPC_CHANNELS.sites.create]: (payload: unknown) =>
      safeHandle(() => {
        assertUnlockedForSensitiveOperation(lockService);
        return siteService.create(createSiteInputSchema.parse(payload));
      }),
    [IPC_CHANNELS.sites.update]: (payload: unknown) =>
      safeHandle(() => {
        assertUnlockedForSensitiveOperation(lockService);
        const parsed = updateSiteRequestSchema.parse(payload);
        return siteService.update(parsed.siteId, parsed.input);
      }),
    [IPC_CHANNELS.sites.remove]: (payload: unknown) =>
      safeHandle(async () => {
        assertUnlockedForSensitiveOperation(lockService);
        const parsed = siteIdInputSchema.parse(payload);
        await siteService.remove(parsed.siteId);
      }),
    [IPC_CHANNELS.sites.detectPlatform]: (payload: unknown) =>
      safeHandle(async () => {
        assertUnlockedForSensitiveOperation(lockService);
        const parsed = detectPlatformInputSchema.parse(payload);
        return siteService.detectPlatform(parsed.baseUrl, parsed.useProxy);
      }),
    [IPC_CHANNELS.sites.addAccount]: (payload: unknown) =>
      safeHandle(() => {
        assertUnlockedForSensitiveOperation(lockService);
        const parsed = addSiteAccountInputSchema.parse(payload);
        return siteService.addAccount(parsed.siteId, parsed.account);
      }),
    [IPC_CHANNELS.sites.syncAccounts]: (payload: unknown) =>
      safeHandle(async () => {
        assertUnlockedForSensitiveOperation(lockService);
        const parsed = siteIdInputSchema.parse(payload);
        siteService.get(parsed.siteId);
        const accounts = accountService.listBySite(parsed.siteId);
        const results: RefreshResult[] = [];
        for (const account of accounts) {
          try {
            results.push(await refreshService.refresh(account.id));
          } catch {
            results.push({
              accountId: account.id,
              authState: 'error',
              message: 'Refresh request failed.',
            });
          }
        }
        return { siteId: parsed.siteId, total: accounts.length, results };
      }),
    [IPC_CHANNELS.sites.checkInAccounts]: (payload: unknown) =>
      safeHandle(async () => {
        assertUnlockedForSensitiveOperation(lockService);
        const parsed = siteIdInputSchema.parse(payload);
        const site = siteService.get(parsed.siteId);
        if (!batchCheckInOrchestrator) {
          throw new AppError('NOT_IMPLEMENTED', 'Batch check-in is not available.');
        }
        // 外部签到站：只对第一个账户打开一次，避免批量弹窗。
        if (site.checkInSiteUrl?.trim()) {
          const accounts = accountService.listBySite(parsed.siteId);
          const first = accounts[0];
          if (!first || !checkInService) {
            return { total: 0, results: [] };
          }
          const result = await checkInService.run(first.id);
          return { total: 1, results: [result] };
        }
        const eligibleIds: string[] = [];
        for (const account of accountService.listBySite(parsed.siteId)) {
          const capabilities = await adapterRegistry.get(account.platform).getCapabilities(toAdapterAccount(account));
          if (capabilities.checkIn) eligibleIds.push(account.id);
        }
        return batchCheckInOrchestrator.run(eligibleIds);
      }),
    [IPC_CHANNELS.sites.batchLogin]: (payload?: unknown) =>
      safeHandle(async (): Promise<BatchLoginResult> => {
        assertUnlockedForSensitiveOperation(lockService);
        sitesBatchLoginInputSchema.parse(payload ?? {});
        if (!batchLoginOrchestrator) {
          throw new AppError('NOT_IMPLEMENTED', 'Batch login is not available.');
        }
        const sites = siteService.list();
        const accounts = accountService.list();
        const identityKindById = new Map(
          accounts
            .map(account => account.authRefId)
            .filter((id): id is string => Boolean(id))
            .map(authId => {
              const identity = authIdentityRepository?.get(authId);
              return identity ? ([authId, identity.kind] as const) : null;
            })
            .filter((entry): entry is readonly [string, AuthKind] => entry !== null),
        );
        const oauthProvidersBySiteId = new Map(
          sites.map(site => [
            site.id,
            resolveSiteOAuthProviders(
              site,
              (dependencies.siteOAuthConfigRepo?.list(site.id) ?? []).map(item => item.oauthProvider),
            ),
          ]),
        );
        const eligibleIds = selectBatchLoginAccountIds({
          sites,
          accounts,
          identityKindById,
          oauthProvidersBySiteId,
        });
        return batchLoginOrchestrator.run(eligibleIds);
      }),
    [IPC_CHANNELS.sites.batchCheckIn]: (payload?: unknown) =>
      safeHandle(async () => {
        assertUnlockedForSensitiveOperation(lockService);
        sitesBatchCheckInInputSchema.parse(payload ?? {});
        if (!batchCheckInOrchestrator) {
          throw new AppError('NOT_IMPLEMENTED', 'Batch check-in is not available.');
        }
        const sites = siteService.list();
        const accounts = accountService.list();
        const todayStart = (() => {
          const now = new Date();
          return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        })();
        const checkedInToday =
          checkInResultRepository?.listCheckedInAccountIdsToday(todayStart) ?? new Set<string>();
        const checkInCapableAccountIds = new Set<string>();
        for (const account of accounts) {
          const capabilities = await adapterRegistry
            .get(account.platform)
            .getCapabilities(toAdapterAccount(account));
          if (capabilities.checkIn) checkInCapableAccountIds.add(account.id);
        }
        const eligibleIds = selectBatchCheckInAccountIds({
          sites,
          accounts,
          checkedInAccountIdsToday: checkedInToday,
          checkInCapableAccountIds,
        });
        return batchCheckInOrchestrator.run(eligibleIds);
      }),
    [IPC_CHANNELS.sites.getSummaries]: (payload?: unknown) =>
      safeHandle(() => {
        assertUnlockedForSensitiveOperation(lockService);
        sitesListInputSchema.parse(payload ?? {});
        return siteService.getSummaries();
      }),
    [IPC_CHANNELS.sites.openWebsite]: (payload: unknown) =>
      safeHandle(async () => {
        assertUnlockedForSensitiveOperation(lockService);
        const parsed = siteIdInputSchema.parse(payload);
        // 站点 baseUrl 已在落库前经 normalizeBaseUrl 规范化并限 http/https，可安全外开。
        const site = siteService.get(parsed.siteId);
        await shell.openExternal(site.baseUrl);
      }),
    [IPC_CHANNELS.sites.getOAuthConfigs]: (payload: unknown) =>
      safeHandle(() => {
        assertUnlockedForSensitiveOperation(lockService);
        const parsed = getOAuthConfigsInputSchema.parse(payload);
        return dependencies.siteOAuthConfigRepo?.list(parsed.siteId) ?? [];
      }),
    [IPC_CHANNELS.sites.upsertOAuthConfig]: (payload: unknown) =>
      safeHandle(() => {
        assertUnlockedForSensitiveOperation(lockService);
        const parsed = upsertOAuthConfigInputSchema.parse(payload);
        dependencies.siteOAuthConfigRepo?.upsert(
          parsed.siteId,
          parsed.provider,
          parsed.clientId,
          parsed.note,
        );
      }),
    [IPC_CHANNELS.sites.deleteOAuthConfig]: (payload: unknown) =>
      safeHandle(() => {
        assertUnlockedForSensitiveOperation(lockService);
        const parsed = deleteOAuthConfigInputSchema.parse(payload);
        dependencies.siteOAuthConfigRepo?.delete(parsed.siteId, parsed.provider);
      }),
    [IPC_CHANNELS.accounts.list]: () => safeHandle(() => accountService.list()),
    [IPC_CHANNELS.accounts.create]: (payload: unknown) =>
      safeHandle(() => {
        assertUnlockedForSensitiveOperation(lockService);
        const parsed = createAccountInputSchema.parse(payload);
        return accountService.create(parsed);
      }),
    [IPC_CHANNELS.accounts.update]: (id: unknown, payload: unknown) =>
      safeHandle(() => {
        assertUnlockedForSensitiveOperation(lockService);
        const accountId = removeAccountInputSchema.parse({ accountId: id }).accountId;
        const parsed = updateAccountInputSchema.parse(payload);
        return accountService.update(accountId, parsed);
      }),
    [IPC_CHANNELS.accounts.copy]: (id: unknown) =>
      safeHandle(() => {
        assertUnlockedForSensitiveOperation(lockService);
        const accountId = copyAccountInputSchema.parse({ accountId: id }).accountId;
        return accountService.copy(accountId);
      }),
    [IPC_CHANNELS.accounts.remove]: (id: unknown) =>
      safeHandle(async () => {
        assertUnlockedForSensitiveOperation(lockService);
        const accountId = removeAccountInputSchema.parse({ accountId: id }).accountId;
        await accountService.remove(accountId);
      }),
    [IPC_CHANNELS.accounts.refresh]: (id: unknown) =>
      safeHandle(async () => {
        assertUnlockedForSensitiveOperation(lockService);
        const accountId = refreshAccountInputSchema.parse({ accountId: id }).accountId;
        return refreshService.refresh(accountId);
      }),
    [IPC_CHANNELS.accounts.getCapabilities]: (payload: unknown) =>
      safeHandle(async () => {
        assertUnlockedForSensitiveOperation(lockService);
        const parsed = getCapabilitiesInputSchema.parse(payload);
        const account = accountService.list().find(item => item.id === parsed.accountId);
        if (!account) {
          throw new AppError('ACCOUNT_NOT_FOUND', 'Account was not found.');
        }

        const adapterAccount = toAdapterAccount(account);
        const capabilities = await adapterRegistry.get(account.platform).getCapabilities(adapterAccount);
        return {
          embeddedLogin: capabilities.embeddedLogin,
          linuxDoOAuth: capabilities.linuxDoOAuth,
          checkIn: capabilities.checkIn,
          pages: capabilities.pages,
        } satisfies AccountPageCapabilities;
      }),
    [IPC_CHANNELS.accounts.getSnapshots]: (payload: unknown) =>
      safeHandle(() => {
        assertUnlockedForSensitiveOperation(lockService);
        const parsed = getSnapshotsInputSchema.parse(payload);
        if (!snapshotRepository) {
          return [] as AccountSnapshot[];
        }

        // 只暴露非敏感展示字段（kind/payload/单位/时间），不外泄内部 id 与 is_latest。
        return snapshotRepository.getLatest(parsed.accountId).map(entity => ({
          kind: entity.kind,
          payloadJson: entity.payloadJson,
          semanticUnit: entity.semanticUnit,
          fetchedAt: entity.fetchedAt,
        })) as AccountSnapshot[];
      }),
    [IPC_CHANNELS.auth.status]: (payload?: unknown) =>
      safeHandle(() => {
        authStatusInputSchema.parse(payload ?? {});
        return getAuthStatus(lockService);
      }),
    [IPC_CHANNELS.auth.unlock]: (payload: unknown) =>
      safeHandle(async () => {
        const parsed = unlockInputSchema.parse(payload);

        if (!lockService.isInitialized()) {
          await lockService.initialize(parsed.masterPassword);
          return;
        }

        await lockService.unlock(parsed.masterPassword);
      }),
    [IPC_CHANNELS.auth.lock]: (payload?: unknown) =>
      safeHandle(() => {
        lockInputSchema.parse(payload ?? {});
        lockService.lock();
      }),
    [IPC_CHANNELS.auth.openLogin]: (payload: unknown) =>
      safeHandle(() => {
        assertUnlockedForSensitiveOperation(lockService);
        const parsed = openLoginInputSchema.parse(payload);
        if (!loginFlowService) {
          throw new AppError('NOT_IMPLEMENTED', 'Login flow is not available.');
        }
        return loginFlowService.open(parsed.accountId, parsed.mode ?? 'auto');
      }),
    [IPC_CHANNELS.auth.importCookies]: (payload: unknown) =>
      safeHandle(async () => {
        assertUnlockedForSensitiveOperation(lockService);
        const parsed = importCookiesInputSchema.parse(payload);
        if (!cookieImport) {
          throw new AppError('NOT_IMPLEMENTED', 'Cookie import is not available.');
        }
        return cookieImport.import(parsed.accountId, parsed.cookieHeader);
      }),
    [IPC_CHANNELS.auth.clearSession]: (payload: unknown) =>
      safeHandle(async () => {
        assertUnlockedForSensitiveOperation(lockService);
        const parsed = clearSessionInputSchema.parse(payload);
        await accountService.clearSession(parsed.accountId);
      }),
    [IPC_CHANNELS.authIdentities.list]: (payload?: unknown) =>
      safeHandle(() => {
        assertUnlockedForSensitiveOperation(lockService);
        authIdentitiesListInputSchema.parse(payload ?? {});
        if (!authIdentities) {
          throw new AppError('NOT_IMPLEMENTED', 'Auth identities are not available.');
        }
        return authIdentities.list();
      }),
    [IPC_CHANNELS.authIdentities.create]: (payload: unknown) =>
      safeHandle(() => {
        assertUnlockedForSensitiveOperation(lockService);
        const parsed = createAuthIdentityInputSchema.parse(payload);
        if (!authIdentities) {
          throw new AppError('NOT_IMPLEMENTED', 'Auth identities are not available.');
        }
        return authIdentities.create({ kind: parsed.kind, label: parsed.label, note: parsed.note, useProxy: parsed.useProxy });
      }),
    [IPC_CHANNELS.authIdentities.update]: (payload: unknown) =>
      safeHandle(() => {
        assertUnlockedForSensitiveOperation(lockService);
        const parsed = updateAuthIdentityInputSchema.parse(payload);
        if (!authIdentities) {
          throw new AppError('NOT_IMPLEMENTED', 'Auth identities are not available.');
        }
        return authIdentities.update(parsed.authId, { label: parsed.label, note: parsed.note, useProxy: parsed.useProxy });
      }),
    [IPC_CHANNELS.authIdentities.remove]: (payload: unknown) =>
      safeHandle(() => {
        assertUnlockedForSensitiveOperation(lockService);
        const parsed = authIdentityIdInputSchema.parse(payload);
        if (!authIdentities) {
          throw new AppError('NOT_IMPLEMENTED', 'Auth identities are not available.');
        }
        authIdentities.remove(parsed.authId);
      }),
    [IPC_CHANNELS.authIdentities.saveCredential]: (payload: unknown) =>
      safeHandle(() => {
        assertUnlockedForSensitiveOperation(lockService);
        // 明文只在此一次性接收并立即交由服务加密落盘，绝不回传、不记日志。
        const parsed = saveAuthCredentialInputSchema.parse(payload);
        if (!authIdentities) {
          throw new AppError('NOT_IMPLEMENTED', 'Auth identities are not available.');
        }
        authIdentities.saveCredential(parsed.authId, {
          username: parsed.username,
          password: parsed.password,
        });
      }),
    [IPC_CHANNELS.authIdentities.hasCredential]: (payload: unknown) =>
      safeHandle(() => {
        assertUnlockedForSensitiveOperation(lockService);
        const parsed = authIdentityIdInputSchema.parse(payload);
        if (!authIdentities) {
          throw new AppError('NOT_IMPLEMENTED', 'Auth identities are not available.');
        }
        return authIdentities.hasCredential(parsed.authId);
      }),
    [IPC_CHANNELS.authIdentities.openLogin]: (payload: unknown) =>
      safeHandle(() => {
        assertUnlockedForSensitiveOperation(lockService);
        const parsed = openAuthIdentityLoginInputSchema.parse(payload);
        if (!authIdentities) {
          throw new AppError('NOT_IMPLEMENTED', 'Auth identities are not available.');
        }
        return authIdentities.openLogin(parsed.authId, parsed.target);
      }),
    [IPC_CHANNELS.accounts.linkAuth]: (payload: unknown) =>
      safeHandle(() => {
        assertUnlockedForSensitiveOperation(lockService);
        const parsed = linkAccountAuthInputSchema.parse(payload);
        return accountService.linkAuth(parsed.accountId, parsed.authId);
      }),
    [IPC_CHANNELS.checkIn.runOne]: (payload: unknown) =>
      safeHandle(async () => {
        assertUnlockedForSensitiveOperation(lockService);
        const parsed = runOneCheckInInputSchema.parse(payload);
        if (!checkInService) {
          throw new AppError('NOT_IMPLEMENTED', 'Check-in is not available.');
        }
        return checkInService.run(parsed.accountId);
      }),
    [IPC_CHANNELS.checkIn.runAll]: (payload?: unknown) =>
      safeHandle(async () => {
        assertUnlockedForSensitiveOperation(lockService);
        runAllCheckInInputSchema.parse(payload ?? {});
        if (!batchCheckInOrchestrator) {
          throw new AppError('NOT_IMPLEMENTED', 'Batch check-in is not available.');
        }

        const accounts = accountService.list();
        const eligibleIds: string[] = [];
        for (const account of accounts) {
          const capabilities = await adapterRegistry.get(account.platform).getCapabilities(toAdapterAccount(account));
          if (capabilities.checkIn) {
            eligibleIds.push(account.id);
          }
        }

        return batchCheckInOrchestrator.run(eligibleIds);
      }),
    [IPC_CHANNELS.keys.listByAccount]: (payload: unknown) =>
      safeHandle(async () => {
        assertUnlockedForSensitiveOperation(lockService);
        const parsed = listKeysByAccountInputSchema.parse(payload);
        if (!keys) {
          throw new AppError('NOT_IMPLEMENTED', 'Key management is not available.');
        }
        // 校验账户存在，避免对不存在账户静默返回空列表掩盖错误。
        const account = accountService.list().find(item => item.id === parsed.accountId);
        if (!account) {
          throw new AppError('ACCOUNT_NOT_FOUND', 'Account was not found.');
        }
        return keys.listByAccount(parsed.accountId);
      }),
    [IPC_CHANNELS.keys.reveal]: (payload: unknown) =>
      safeHandle(async () => {
        assertUnlockedForSensitiveOperation(lockService);
        // 明文只在此一次性返回给发起揭示的 Renderer，绝不写日志/快照/缓存。
        const parsed = revealKeyInputSchema.parse(payload);
        if (!keys) {
          throw new AppError('NOT_IMPLEMENTED', 'Key management is not available.');
        }
        const account = accountService.list().find(item => item.id === parsed.accountId);
        if (!account) {
          throw new AppError('ACCOUNT_NOT_FOUND', 'Account was not found.');
        }
        return keys.reveal(parsed.accountId, parsed.tokenId);
      }),
    [IPC_CHANNELS.keys.refresh]: (payload: unknown) =>
      safeHandle(async () => {
        assertUnlockedForSensitiveOperation(lockService);
        const parsed = refreshKeysByAccountInputSchema.parse(payload);
        if (!keys) {
          throw new AppError('NOT_IMPLEMENTED', 'Key management is not available.');
        }
        const account = accountService.list().find(item => item.id === parsed.accountId);
        if (!account) {
          throw new AppError('ACCOUNT_NOT_FOUND', 'Account was not found.');
        }
        return keys.refresh(parsed.accountId);
      }),
    [IPC_CHANNELS.keys.captureAll]: (payload: unknown) =>
      safeHandle(async () => {
        assertUnlockedForSensitiveOperation(lockService);
        // 批量获取明文并加密入库；仅返回计数，绝不回传任何明文本身。
        const parsed = captureKeysByAccountInputSchema.parse(payload);
        if (!keys) {
          throw new AppError('NOT_IMPLEMENTED', 'Key management is not available.');
        }
        const account = accountService.list().find(item => item.id === parsed.accountId);
        if (!account) {
          throw new AppError('ACCOUNT_NOT_FOUND', 'Account was not found.');
        }
        return keys.captureAll(parsed.accountId);
      }),
    [IPC_CHANNELS.models.listByAccount]: (payload: unknown) =>
      safeHandle(async () => {
        assertUnlockedForSensitiveOperation(lockService);
        const parsed = listModelsInputSchema.parse(payload);
        if (!models) {
          throw new AppError('NOT_IMPLEMENTED', 'Model management is not available.');
        }
        // 校验账户存在，避免对不存在账户静默返回空列表掩盖错误。
        const account = accountService.list().find(item => item.id === parsed.accountId);
        if (!account) {
          throw new AppError('ACCOUNT_NOT_FOUND', 'Account was not found.');
        }
        return models.listByAccount(parsed.accountId);
      }),
    [IPC_CHANNELS.logs.listByAccount]: (payload: unknown) =>
      safeHandle(async () => {
        assertUnlockedForSensitiveOperation(lockService);
        const parsed = listLogsByAccountInputSchema.parse(payload);
        if (!logs) {
          throw new AppError('NOT_IMPLEMENTED', 'Usage log management is not available.');
        }
        const account = accountService.list().find(item => item.id === parsed.accountId);
        if (!account) {
          throw new AppError('ACCOUNT_NOT_FOUND', 'Account was not found.');
        }
        const { accountId, ...query } = parsed;
        return logs.listByAccount(accountId, query);
      }),
    [IPC_CHANNELS.apiTest.runText]: (payload: unknown) =>
      safeHandle(async () => {
        assertUnlockedForSensitiveOperation(lockService);
        const parsed = runTextApiTestInputSchema.parse(payload);
        if (!apiTest) {
          throw new AppError('NOT_IMPLEMENTED', 'Text API testing is not available.');
        }
        const account = accountService.list().find(item => item.id === parsed.accountId);
        if (!account) {
          throw new AppError('ACCOUNT_NOT_FOUND', 'Account was not found.');
        }
        return apiTest.runText(parsed);
      }),
    [IPC_CHANNELS.network.getSettings]: (payload?: unknown) =>
      safeHandle(() => {
        assertUnlockedForSensitiveOperation(lockService);
        getNetworkSettingsInputSchema.parse(payload ?? {});
        if (!network) {
          throw new AppError('NOT_IMPLEMENTED', 'Network settings are not available.');
        }
        return network.getSettings();
      }),
    [IPC_CHANNELS.network.updateSettings]: (payload: unknown) =>
      safeHandle(() => {
        assertUnlockedForSensitiveOperation(lockService);
        const parsed = updateNetworkSettingsInputSchema.parse(payload);
        if (!network) {
          throw new AppError('NOT_IMPLEMENTED', 'Network settings are not available.');
        }
        return network.updateSettings(parsed);
      }),
    [IPC_CHANNELS.pages.openInApp]: (payload: unknown) =>
      safeHandle(() => {
        assertUnlockedForSensitiveOperation(lockService);
        const parsed = openKnownPageInputSchema.parse(payload);
        const { account, url } = resolveKnownPageUrl(parsed.accountId, parsed.page);
        // 应用内打开走账户专属 partition 的受控容器（组合根注入）；未接线则视为未实现。
        if (!inAppPageOpener) {
          throw new AppError('NOT_IMPLEMENTED', 'In-app page opening is not available.');
        }
        return inAppPageOpener({ accountId: account.id, baseUrl: account.baseUrl, url: url.toString() });
      }),
    [IPC_CHANNELS.pages.openExternal]: (payload: unknown) =>
      safeHandle(async () => {
        assertUnlockedForSensitiveOperation(lockService);
        const parsed = openKnownPageInputSchema.parse(payload);
        // 外部浏览器仅获得目标 URL，绝不复制 Cookie/会话；未确认页面在解析阶段已被拒绝。
        const { url } = resolveKnownPageUrl(parsed.accountId, parsed.page);
        await shell.openExternal(url.toString());
      }),
    [IPC_CHANNELS.pages.closeEmbedded]: (payload?: unknown) =>
      safeHandle(() => {
        assertUnlockedForSensitiveOperation(lockService);
        closeEmbeddedInputSchema.parse(payload ?? {});
        // 关闭当前内嵌视图；未接线时静默通过（无活动视图可关）。
        embeddedPage?.close();
      }),
    [IPC_CHANNELS.pages.reportContentBounds]: (payload: unknown) =>
      safeHandle(() => {
        assertUnlockedForSensitiveOperation(lockService);
        const bounds = contentBoundsInputSchema.parse(payload);
        // 仅上报内容区几何用于内嵌视图定位；无活动视图时接线层记忆最近值。
        embeddedPage?.reportBounds(bounds);
      }),
    // 窗口控制不涉及敏感数据，锁定页也需能最小化/关闭，故不做解锁校验；
    // 动作集合固定，不接受任意句柄/坐标/尺寸，无法被滥用为窗口操纵能力。
    [IPC_CHANNELS.window.minimize]: (payload?: unknown) =>
      safeHandle(() => {
        windowCommandInputSchema.parse(payload ?? {});
        windowControl?.minimize();
      }),
    [IPC_CHANNELS.window.toggleMaximize]: (payload?: unknown) =>
      safeHandle(() => {
        windowCommandInputSchema.parse(payload ?? {});
        return windowControl?.toggleMaximize() ?? false;
      }),
    [IPC_CHANNELS.window.close]: (payload?: unknown) =>
      safeHandle(() => {
        windowCommandInputSchema.parse(payload ?? {});
        windowControl?.close();
      }),
    [IPC_CHANNELS.window.isMaximized]: (payload?: unknown) =>
      safeHandle(() => {
        windowCommandInputSchema.parse(payload ?? {});
        return windowControl?.isMaximized() ?? false;
      }),
  };
}
