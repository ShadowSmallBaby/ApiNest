import type Database from 'better-sqlite3';
import { app, BrowserWindow, WebContentsView, session } from 'electron';
import { AccountService } from './accounts/account-service';
import { AdapterRegistry } from './adapters/adapter-registry';
import { ElectronProbeClient } from './adapters/electron-probe-client';
import { ElectronSessionRequestClient } from './adapters/electron-session-request-client';
import { NewApiAdapter } from './adapters/newapi/newapi-adapter';
import { NewApiQueriesClient } from './adapters/newapi/newapi-queries-client';
import { NewApiStatusClient } from './adapters/newapi/newapi-status-client';
import { NewApiKeysClient } from './adapters/newapi/newapi-keys-client';
import { NewApiModelsClient } from './adapters/newapi/newapi-models-client';
import { NewApiLogsClient } from './adapters/newapi/newapi-logs-client';
import { NewApiSessionValidator } from './adapters/newapi/newapi-session-validator';
import { UnsupportedPlatformAdapter } from './adapters/unsupported-adapter';
import { ControlledBrowserContainer } from './browser/browser-container';
import {
  EMBEDDED_VIEW_WEB_PREFERENCES,
  EmbeddedPageViewManager,
  type EmbeddedViewHandle,
  type ViewBounds,
} from './browser/embedded-page-view';
import { CheckInService } from './checkin/checkin-service';
import { BatchCheckInOrchestrator } from './checkin/batch-checkin-orchestrator';
import { BatchLoginOrchestrator } from './auth/batch-login-orchestrator';
import { KeysService } from './keys/keys-service';
import { ModelsService } from './models/models-service';
import { LogsService } from './logs/logs-service';
import { TextApiTestService } from './api-test/text-api-test-service';
import { DashboardService } from './dashboard/dashboard-service';
import { RefreshService } from './refresh/refresh-service';
import { SnapshotRepository } from './storage/repositories/snapshot-repository';
import { OperationRepository } from './storage/repositories/operation-repository';
import type { PlatformAdapter } from '../shared/domain/platform-adapter';
import type { PlatformType } from '../shared/ipc/bridge';
import { AuthSessionService } from './auth/auth-session-service';
import { LoginFlowService } from './auth/login-flow-service';
import { AuthIdentityService } from './auth/auth-identity-service';
import { AuthIdentityLoginFlow } from './auth/auth-identity-login-flow';
import { SiteCredentialService } from './auth/site-credential-service';
import { AuthIdentityRepository } from './storage/repositories/auth-identity-repository';
import { SessionPartitionManager } from './auth/session-partition-manager';
import { IdpCookieSyncService } from './auth/idp-cookie-sync';
import { CookieImportService } from './auth/cookie-import-service';
import { LinuxDoHeadlessLogin } from './adapters/newapi/linuxdo-headless-login';
import { GitHubHeadlessLogin } from './adapters/newapi/github-headless-login';
import { buildIpcHandlers } from './ipc/handlers';
import { registerIpcHandlers } from './ipc/register';
import { WindowControlService } from './window/window-control-service';
import { IPC_CHANNELS } from '../shared/ipc/channels';
import { LockService } from './security/lock-service';
import { VaultService } from './security/vault-service';
import { openDatabase } from './storage/database';
import { AccountAuthStateRepository } from './storage/repositories/account-auth-state-repository';
import { CheckInResultRepository } from './storage/repositories/checkin-result-repository';
import { AccountRepository } from './storage/repositories/account-repository';
import { AccountKeysRepository } from './storage/repositories/account-keys-repository';
import { SiteRepository } from './storage/repositories/site-repository';
import { SiteOAuthConfigRepository } from './storage/site-oauth-config-repository';
import { SiteService } from './sites/site-service';
import { runMigrations } from './storage/run-migrations';
import { createMainWindow } from './window/create-main-window';
import { NetworkSettingsRepository } from './storage/repositories/network-settings-repository';
import { NetworkSettingsService } from './network/network-settings-service';
import { NetworkPolicyResolver } from './network/network-policy-resolver';
import { SessionNetworkConfigurator } from './network/session-network-configurator';
import { toNetworkSettingsView, rawFromNetworkSettingsView } from './network/network-view';
import type { NetworkSettings } from './network/network-types';

// 部分站点通告 HTTP/3 但 QUIC 握手失败且未回退到 TCP（ERR_QUIC_PROTOCOL_ERROR），
// 导致内嵌登录页整页加载失败。禁用 QUIC 强制走 TCP/HTTP2。必须在 app ready 前调用。
app.commandLine.appendSwitch('disable-quic');

let database: Database.Database | null = null;
let lockService: LockService | null = null;
let databaseClosed = false;
let mainWindow: BrowserWindow | null = null;

// Renderer 最近上报的内容区几何；内嵌视图挂载/复位时据此定位。
let lastContentBounds: ViewBounds | null = null;

// 内容区几何缺省值：Renderer 尚未上报 bounds 前的保守初始值（贴合默认窗口内容区）。
const DEFAULT_CONTENT_BOUNDS: ViewBounds = { x: 240, y: 40, width: 1040, height: 760 };

function clearSensitiveState(): void {
  lockService?.lock();
}

function closeDatabase(): void {
  if (!database || databaseClosed) {
    return;
  }

  database.close();
  databaseClosed = true;
}

/**
 * 应用全局 Secure DNS（app.configureHostResolver，运行时可热切换，无需重启）。
 * secure 模式失败：启动阶段视为致命；热更新时返回错误文案，不静默回退。
 * off / automatic 失败不阻断（本就允许普通 DNS）。
 */
function applyHostResolver(
  settings: NetworkSettings,
  options: { fatalOnSecureFailure?: boolean } = {},
): { ok: boolean; error?: string } {
  const { secureDns } = settings;
  const fatalOnSecureFailure = options.fatalOnSecureFailure ?? false;
  try {
    app.configureHostResolver({
      secureDnsMode: secureDns.mode,
      // 仅 secure 注入自定义 DoH；off/automatic 的 servers 仅作配置保留。
      ...(secureDns.mode === 'secure' ? { secureDnsServers: secureDns.servers } : {}),
    });
    return { ok: true };
  } catch (error) {
    if (secureDns.mode === 'secure' && fatalOnSecureFailure) {
      throw error;
    }
    const message =
      error instanceof Error ? error.message : 'Failed to apply Secure DNS settings.';
    return { ok: false, error: message };
  }
}

/**
 * 创建主窗口并接线 maximize 状态推送（R12）。
 * 窗口最大化/还原时向 Renderer 发送最新状态，用于同步自绘按钮图标。
 */
function setupMainWindow(): BrowserWindow {
  const window = createMainWindow();

  const pushMaximizeState = (): void => {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.window.maximizeChanged, window.isMaximized());
    }
  };
  window.on('maximize', pushMaximizeState);
  window.on('unmaximize', pushMaximizeState);
  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  return window;
}

app.whenReady().then(async () => {
  database = openDatabase();
  runMigrations(database);

  const vaultService = new VaultService(database);
  lockService = new LockService(vaultService);
  const accountRepository = new AccountRepository(database);
  const siteRepository = new SiteRepository(database);
  const authIdentityRepository = new AuthIdentityRepository(database);
  const authStateRepository = new AccountAuthStateRepository(database);
  const accountKeysRepository = new AccountKeysRepository(database);
  const siteOAuthConfigRepository = new SiteOAuthConfigRepository(database);

  // 网络设置（阶段 6）：在任何 Session 创建或联网前，先读取全局 Secure DNS / Proxy 模板，
  // 应用应用级 Host Resolver（可热切换），再装配 partition 级 Proxy 屏障组件。
  const networkSettingsRepository = new NetworkSettingsRepository(database);
  const networkSettingsService = new NetworkSettingsService({
    get: () => networkSettingsRepository.get(),
    update: raw =>
      networkSettingsRepository.update({ ...raw, updatedAt: new Date().toISOString() }),
  });
  applyHostResolver(networkSettingsService.getSettings(), { fatalOnSecureFailure: true });

  const networkConfigurator = new SessionNetworkConfigurator();
  const networkPolicyResolver = new NetworkPolicyResolver({
    accounts: accountRepository,
    sites: siteRepository,
    auths: authIdentityRepository,
    settings: networkSettingsService,
  });
  const sessionPartitionManager = new SessionPartitionManager(session, {
    policy: networkPolicyResolver,
    barrier: {
      ensure: (partition, sess, config) => networkConfigurator.ensure(partition, sess, config),
      invalidate: partition => networkConfigurator.invalidate(partition),
    },
  });
  const browserContainer = new ControlledBrowserContainer({
    partitionManager: sessionPartitionManager,
    windowFactory: {
      create: options => {
        const window = new BrowserWindow(options);
        return {
          webContents: window.webContents,
          session: window.webContents.session,
          loadURL: url => window.loadURL(url),
          on: (event, listener) => window.on(event, listener),
          show: () => window.show(),
          destroy: () => window.destroy(),
        };
      },
    },
  });
  // 会话请求客户端：在账户专属 partition 内发带凭据请求（5.3 登录态校验）；
  // 阶段 6 起 fetch 前先过账户 partition 的网络策略屏障。
  const sessionClient = new ElectronSessionRequestClient({ partitionManager: sessionPartitionManager });

  // 平台适配器注册表。NewAPI 注入探测客户端（5.2）与会话客户端（5.3）；
  // Sub2API / CPA 仅注册为不支持占位。
  const probeClient = new ElectronProbeClient({ partitionManager: sessionPartitionManager });
  const newApiAdapter = new NewApiAdapter({ probeClient, sessionClient });
  const adapters = new Map<PlatformType, PlatformAdapter>([
    ['newapi', newApiAdapter],
    ['sub2api', new UnsupportedPlatformAdapter('sub2api')],
    ['cliproxyapi', new UnsupportedPlatformAdapter('cliproxyapi')],
  ]);
  const adapterRegistry = new AdapterRegistry(adapters);

  const accountService = new AccountService(accountRepository, {
    sessionCleaner: sessionPartitionManager,
    authStateRepository,
    authIdentityRepository,
  });
  // 站点广场聚合所需的两个 repository 提前定义（供 SiteService.getSummaries 注入）；
  // 下方刷新/签到编排复用同一实例。
  const snapshotRepository = new SnapshotRepository(database);
  const checkInResultRepository = new CheckInResultRepository(database);
  const siteService = new SiteService({
    siteRepository,
    accountRepository,
    authIdentityRepository,
    platformDetector: newApiAdapter,
    sessionCleaner: sessionPartitionManager,
    networkInvalidator: sessionPartitionManager,
    snapshotRepository,
    checkInResultRepository,
  });

  // 应用内嵌页面视图（R11）：基于 WebContentsView 挂载到主窗口内容区。
  // 复用与受控独立容器一致的安全策略，绑定账户专属 partition，不注入本应用 Preload。
  // 用 WeakMap 关联 handle→WebContentsView，避免在 handle 上暴露 Electron 具体类型。
  const embeddedViews = new WeakMap<EmbeddedViewHandle, WebContentsView>();
  /** 向主窗口推送内嵌页加载态；窗口已销毁时静默忽略。 */
  const pushEmbeddedLoadState = (state: import('../shared/ipc/bridge').EmbeddedPageLoadState): void => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.pages.loadingChanged, state);
    }
  };
  const embeddedPageViewManager = new EmbeddedPageViewManager({
    partitionManager: sessionPartitionManager,
    onLoadStateChange: pushEmbeddedLoadState,
    viewFactory: {
      create: ({ partition }) => {
        const view = new WebContentsView({
          webPreferences: {
            ...EMBEDDED_VIEW_WEB_PREFERENCES,
            partition,
          },
        });
        const handle: EmbeddedViewHandle = {
          webContents: view.webContents,
          session: view.webContents.session,
          loadURL: url => view.webContents.loadURL(url),
          setBounds: bounds => view.setBounds(bounds),
          setVisible: visible => view.setVisible(visible),
          destroy: () => {
            if (!view.webContents.isDestroyed()) {
              view.webContents.close();
            }
          },
        };
        embeddedViews.set(handle, view);
        return handle;
      },
      attach: handle => {
        const view = embeddedViews.get(handle);
        if (view && mainWindow) {
          mainWindow.contentView.addChildView(view);
        }
      },
      detach: handle => {
        const view = embeddedViews.get(handle);
        if (view && mainWindow) {
          mainWindow.contentView.removeChildView(view);
        }
        embeddedViews.delete(handle);
      },
    },
  });

  // 会话校验编排。容器关闭后主动校验目标站点会话，只有 active 才视为登录成功。
  const authSessionService = new AuthSessionService({
    authStateRepository,
    accountRepository,
    sessionValidator: new NewApiSessionValidator({ sessionClient }),
  });

  // 绑定 auth 身份的 IdP Cookie 同步（R13 演进，已授权改写红线）：
  // 打开站点登录窗前，将 auth 专属 partition 的 IdP Cookie 注入账户 partition，
  // 仅 github/linuxdo、仅白名单域、仅主进程内，绝不复制站点 Cookie 或跨账户。
  const idpCookieSync = new IdpCookieSyncService({
    partitionManager: sessionPartitionManager,
  });

  // LinuxDo 无头自动登录（2026-07-22 主人授权：可代点同意；code 瞬态不落库）。
  const linuxDoHeadlessLogin = new LinuxDoHeadlessLogin({
    sessionClient,
    siteIdentityStore: authStateRepository,
    refreshAuthState: accountId => authSessionService.refreshAuthState(accountId),
  });

  // GitHub 无头自动登录：state → authorize → /oauth/github 回调写 Cookie。
  const githubHeadlessLogin = new GitHubHeadlessLogin({
    sessionClient,
    siteIdentityStore: authStateRepository,
    refreshAuthState: accountId => authSessionService.refreshAuthState(accountId),
  });

  const loginFlowService = new LoginFlowService({
    accountRepository,
    adapterRegistry,
    browserContainer,
    authSessionService,
    authIdentityRepository,
    idpCookieSync,
    // NewAPI manual 登录时受控捕获站内数字用户 ID（写入 account_auth_state，非凭据）。
    siteIdentityStore: authStateRepository,
    linuxDoHeadlessLogin,
    githubHeadlessLogin,
    // 优先从站点级多 OAuth 配置表解析 Client ID。
    siteOAuthClientIds: siteOAuthConfigRepository,
  });

  // 手动导入站点 Cookie 到账户 partition（2026-07-22 主人授权）。
  const cookieImportService = new CookieImportService({
    accountRepository,
    partitionManager: sessionPartitionManager,
    authSessionService,
  });

  // 站点账号密码加密凭据引用（R13）：复用 Vault 信封加密，只做存/删/存在性/主进程内揭示。
  const siteCredentialService = new SiteCredentialService({ vault: vaultService });
  const authIdentityService = new AuthIdentityService({
    repository: authIdentityRepository,
    credentials: siteCredentialService,
    networkInvalidator: sessionPartitionManager,
  });
  // auth 身份的「登录一次」流程：github/linuxdo 在 auth 专属 partition 打开 IdP 官方页登录。
  const authIdentityLoginFlow = new AuthIdentityLoginFlow({
    repository: authIdentityRepository,
    browserContainer,
  });

  // 用户侧刷新编排（5.4）。成功写最新快照、失败记 error 且不覆盖旧快照、
  // 单项解析 null 保留旧值不填 0。
  const operationRepository = new OperationRepository(database);
  const checkInService = new CheckInService({
    accountRepository,
    authStateRepository,
    adapterRegistry,
    operationRepository,
    checkInResultRepository,
    siteRepository,
    authIdentityRepository,
    idpCookieSync,
    browserContainer,
  });
  const batchCheckInOrchestrator = new BatchCheckInOrchestrator({ checkInService });
  const batchLoginOrchestrator = new BatchLoginOrchestrator({ loginFlowService });
  const dashboardService = new DashboardService({
    accountService,
    snapshotRepository,
    operationRepository,
  });
  const queriesClient = new NewApiQueriesClient({ sessionClient });
  const statusClient = new NewApiStatusClient(probeClient);
  const refreshService = new RefreshService({
    queriesClient,
    statusClient,
    snapshotRepository,
    operationRepository,
    accountRepository,
    authStateRepository,
  });

  // 密钥管理（阶段 1）：在账户专属 partition 内拉取/揭示 NewAPI token。
  // listByAccount 返回脱敏视图；reveal 明文仅当次返回，绝不写日志/快照/缓存。
  const keysClient = new NewApiKeysClient({ sessionClient });
  const keysService = new KeysService({
    accountRepository,
    authStateRepository,
    keysClient,
    keysRepository: accountKeysRepository,
    vault: vaultService,
  });

  // 模型管理（阶段 2）：拉取 /api/pricing + /api/user/models，标注账户可用模型。
  // 解析失败返回 null（保守置不可用）；仅 newapi 平台支持。
  const modelsClient = new NewApiModelsClient({ sessionClient });
  const modelsService = new ModelsService({ accountRepository, authStateRepository, modelsClient });

  // 日志管理（阶段 3）：在线分页拉取 /api/log/self，仅返回安全投影，不持久化原始日志。
  const logsClient = new NewApiLogsClient({ sessionClient });
  const logsService = new LogsService({ accountRepository, authStateRepository, logsClient });

  // 文本 API 测试（阶段 4）：主进程揭示所选密钥并发起固定端点请求，明文不进入 Renderer。
  const textApiTestService = new TextApiTestService({
    accountRepository,
    keysService,
    modelsService,
    sessionClient,
  });

  // 窗口控制服务（R12）：只暴露固定枚举动作，作用于当前主窗口。
  const windowControlService = new WindowControlService({
    getWindow: () => mainWindow,
  });

  registerIpcHandlers(
    buildIpcHandlers({
      lockService,
      accountService,
      siteService,
      siteOAuthConfigRepo: siteOAuthConfigRepository,
      adapterRegistry,
      refreshService,
      snapshotRepository,
      checkInService,
      batchCheckInOrchestrator,
      batchLoginOrchestrator,
      checkInResultRepository,
      authIdentityRepository,
      dashboardService,
      loginFlowService,
      windowControl: windowControlService,
      // 密钥管理（阶段 1）。listByAccount 返回脱敏视图；reveal 明文仅当次返回，
      // 绝不写日志/快照/缓存；仅 newapi 平台支持，其余在服务层报 NOT_IMPLEMENTED。
      keys: {
        listByAccount: accountId => keysService.listByAccount(accountId),
        refresh: accountId => keysService.refresh(accountId),
        reveal: (accountId, tokenId) => keysService.reveal(accountId, tokenId),
        captureAll: accountId => keysService.captureAll(accountId),
      },
      // 模型管理（阶段 2）。listByAccount 返回账户可用模型标注视图；
      // 仅 newapi 平台支持，其余在服务层报 NOT_IMPLEMENTED。
      models: {
        listByAccount: accountId => modelsService.listByAccount(accountId),
      },
      // 日志管理（阶段 3）。固定单账户 partition 在线查询，禁止跨账户合并或原始响应落盘。
      logs: {
        listByAccount: (accountId, query) => logsService.listByAccount(accountId, query),
      },
      // 文本 API 测试（阶段 4）。Renderer 只提交 tokenId，完整密钥仅在主进程局部变量中使用。
      apiTest: {
        runText: input => textApiTestService.run(input),
      },
      // 网络设置（阶段 6）。读取/更新全局 Secure DNS 与 Proxy 模板；Proxy 变更后使所有已知
      // partition 失效，下次请求前热切换（setProxy + closeAllConnections）；DNS 变更重启生效。
      network: {
        getSettings: () => toNetworkSettingsView(networkSettingsService.getSettings()),
        updateSettings: view => {
          const result = networkSettingsService.updateSettings(rawFromNetworkSettingsView(view));
          if (result.proxyChanged) {
            networkConfigurator.invalidateAll();
          }
          let dnsApplied: boolean | undefined;
          let dnsApplyError: string | undefined;
          if (result.dnsChanged) {
            const applied = applyHostResolver(result.settings);
            dnsApplied = applied.ok;
            dnsApplyError = applied.error;
          }
          return toNetworkSettingsView(result.settings, { dnsApplied, dnsApplyError });
        },
      },
      cookieImport: {
        import: (accountId, cookieHeader) => cookieImportService.import(accountId, cookieHeader),
      },
      // 应用内打开：挂载内嵌视图到内容区（R11）。bounds 缺省时由管理器沿用最近上报值。
      inAppPageOpener: async request => {
        await embeddedPageViewManager.mount({
          accountId: request.accountId,
          baseUrl: request.baseUrl,
          startUrl: request.url,
          bounds: request.bounds ?? lastContentBounds ?? DEFAULT_CONTENT_BOUNDS,
        });
      },
      // auth 身份实体化管理（R13 演进）。身份 CRUD + password 凭据存/存在性 + IdP 登录；
      // password 明文只在主进程内用于目标站点表单填充，绝不回传 Renderer；
      // github/linuxdo 登录在 auth 专属 partition 内完成，不与账户 partition 共享会话。
      authIdentities: {
        list: () => authIdentityService.list(),
        create: input => authIdentityService.create(input),
        update: (authId, input) => authIdentityService.update(authId, input),
        remove: authId => authIdentityService.remove(authId),
        saveCredential: (authId, input) => authIdentityService.saveCredential(authId, input),
        hasCredential: authId => authIdentityService.hasCredential(authId),
        openLogin: (authId, target) => authIdentityLoginFlow.open(authId, target),
      },
      embeddedPage: {
        close: () => embeddedPageViewManager.unmount(),
        reportBounds: bounds => {
          lastContentBounds = bounds;
          embeddedPageViewManager.setBounds(bounds);
        },
      },
    }),
  );
  mainWindow = setupMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = setupMainWindow();
    }
  });
});

app.on('before-quit', () => {
  clearSensitiveState();
});

app.on('will-quit', () => {
  clearSensitiveState();
  closeDatabase();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
