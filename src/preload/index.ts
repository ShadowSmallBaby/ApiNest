import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc/channels';
import type {
  AccountPageCapabilities,
  AccountRecord,
  AccountSnapshot,
  ApiKeyRecord,
  ApiNestBridge,
  CaptureKeysResult,
  ModelRecord,
  UsageLogPage,
  UsageLogQuery,
  RunTextApiTestInput,
  TextApiTestResult,
  AuthIdentity,
  AuthStatus,
  BatchCheckInResult,
  BatchLoginResult,
  CheckInResult,
  DashboardOverview,
  KnownPage,
  LoginMode,
  LoginResult,
  PlatformDetectionResult,
  RefreshResult,
  SiteMutationResult,
  SiteRecord,
  SiteSummary,
  SiteSyncResult,
  SiteOAuthConfig,
  OAuthProvider,
  ViewBounds,
  NetworkSettingsView,
  EmbeddedPageLoadState,
} from '../shared/ipc/bridge';
import type {
  CreateAccountInput,
  CreateAuthIdentityInput,
  CreateSiteAccountInput,
  CreateSiteInput,
  UpdateAccountInput,
  UpdateAuthIdentityInput,
  UpdateSiteInput,
  UpdateNetworkSettingsInput,
} from '../shared/ipc/schemas';

const bridge: ApiNestBridge = {
  system: {
    version: '0.1.0',
  },
  window: {
    minimize: () => ipcRenderer.invoke(IPC_CHANNELS.window.minimize, {}) as Promise<void>,
    toggleMaximize: () => ipcRenderer.invoke(IPC_CHANNELS.window.toggleMaximize, {}) as Promise<boolean>,
    close: () => ipcRenderer.invoke(IPC_CHANNELS.window.close, {}) as Promise<void>,
    isMaximized: () => ipcRenderer.invoke(IPC_CHANNELS.window.isMaximized, {}) as Promise<boolean>,
    onMaximizeChange: (listener: (isMaximized: boolean) => void) => {
      // 仅转发布尔状态，不透传原始 Electron 事件对象，避免 Renderer 触达 sender/frame 等能力。
      const channelListener = (_event: unknown, isMaximized: boolean): void => listener(isMaximized);
      ipcRenderer.on(IPC_CHANNELS.window.maximizeChanged, channelListener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.window.maximizeChanged, channelListener);
    },
  },
  dashboard: {
    getOverview: () => ipcRenderer.invoke(IPC_CHANNELS.dashboard.getOverview, {}) as Promise<DashboardOverview>,
  },
  sites: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.sites.list, {}) as Promise<SiteRecord[]>,
    get: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.sites.get, { siteId: id }) as Promise<SiteRecord>,
    create: (input: CreateSiteInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.sites.create, input) as Promise<SiteMutationResult>,
    update: (id: string, input: UpdateSiteInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.sites.update, { siteId: id, input }) as Promise<SiteRecord>,
    remove: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.sites.remove, { siteId: id }) as Promise<void>,
    detectPlatform: (baseUrl: string, useProxy?: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.sites.detectPlatform, { baseUrl, useProxy }) as Promise<PlatformDetectionResult>,
    addAccount: (siteId: string, input: CreateSiteAccountInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.sites.addAccount, { siteId, account: input }) as Promise<AccountRecord>,
    syncAccounts: (siteId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.sites.syncAccounts, { siteId }) as Promise<SiteSyncResult>,
    checkInAccounts: (siteId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.sites.checkInAccounts, { siteId }) as Promise<BatchCheckInResult>,
    batchLogin: () =>
      ipcRenderer.invoke(IPC_CHANNELS.sites.batchLogin, {}) as Promise<BatchLoginResult>,
    batchCheckIn: () =>
      ipcRenderer.invoke(IPC_CHANNELS.sites.batchCheckIn, {}) as Promise<BatchCheckInResult>,
    getSummaries: () => ipcRenderer.invoke(IPC_CHANNELS.sites.getSummaries, {}) as Promise<SiteSummary[]>,
    openWebsite: (siteId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.sites.openWebsite, { siteId }) as Promise<void>,
    getOAuthConfigs: (siteId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.sites.getOAuthConfigs, { siteId }) as Promise<SiteOAuthConfig[]>,
    upsertOAuthConfig: (siteId: string, provider: OAuthProvider, clientId: string, note?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.sites.upsertOAuthConfig, {
        siteId,
        provider,
        clientId,
        note,
      }) as Promise<void>,
    deleteOAuthConfig: (siteId: string, provider: OAuthProvider) =>
      ipcRenderer.invoke(IPC_CHANNELS.sites.deleteOAuthConfig, {
        siteId,
        provider,
      }) as Promise<void>,
  },
  accounts: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.accounts.list) as Promise<AccountRecord[]>,
    create: (input: CreateAccountInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.accounts.create, input) as Promise<AccountRecord>,
    update: (id: string, input: UpdateAccountInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.accounts.update, id, input) as Promise<AccountRecord>,
    copy: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.accounts.copy, id) as Promise<AccountRecord>,
    remove: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.accounts.remove, id) as Promise<void>,
    refresh: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.accounts.refresh, id) as Promise<RefreshResult>,
    getCapabilities: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.accounts.getCapabilities, { accountId: id }) as Promise<AccountPageCapabilities>,
    getSnapshots: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.accounts.getSnapshots, { accountId: id }) as Promise<AccountSnapshot[]>,
    linkAuth: (accountId: string, authId: string | null) =>
      ipcRenderer.invoke(IPC_CHANNELS.accounts.linkAuth, { accountId, authId }) as Promise<AccountRecord>,
  },
  auth: {
    status: () => ipcRenderer.invoke(IPC_CHANNELS.auth.status, {}) as Promise<AuthStatus>,
    unlock: (masterPassword: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.auth.unlock, { masterPassword }) as Promise<void>,
    lock: () => ipcRenderer.invoke(IPC_CHANNELS.auth.lock, {}) as Promise<void>,
    openLogin: (accountId: string, mode?: LoginMode) =>
      ipcRenderer.invoke(IPC_CHANNELS.auth.openLogin, {
        accountId,
        mode: mode ?? 'auto',
      }) as Promise<LoginResult>,
    clearSession: (accountId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.auth.clearSession, { accountId }) as Promise<void>,
    importCookies: (accountId: string, cookieHeader: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.auth.importCookies, {
        accountId,
        cookieHeader,
      }) as Promise<{ imported: number; authState: import('../shared/ipc/bridge').AuthState; message: string }>,
  },
  authIdentities: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.authIdentities.list, {}) as Promise<AuthIdentity[]>,
    create: (input: CreateAuthIdentityInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.authIdentities.create, input) as Promise<AuthIdentity>,
    update: (id: string, input: Omit<UpdateAuthIdentityInput, 'authId'>) =>
      ipcRenderer.invoke(IPC_CHANNELS.authIdentities.update, { authId: id, ...input }) as Promise<AuthIdentity>,
    remove: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.authIdentities.remove, { authId: id }) as Promise<void>,
    saveCredential: (id: string, input: { username: string; password: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.authIdentities.saveCredential, { authId: id, ...input }) as Promise<void>,
    hasCredential: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.authIdentities.hasCredential, { authId: id }) as Promise<boolean>,
    openLogin: (id: string, target?: import('../shared/ipc/bridge').AuthLoginTarget) =>
      ipcRenderer.invoke(IPC_CHANNELS.authIdentities.openLogin, { authId: id, target }) as Promise<LoginResult>,
  },
  checkIn: {
    runOne: (accountId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.checkIn.runOne, { accountId }) as Promise<CheckInResult>,
    runAll: () => ipcRenderer.invoke(IPC_CHANNELS.checkIn.runAll, {}) as Promise<BatchCheckInResult>,
  },
  keys: {
    listByAccount: (accountId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.keys.listByAccount, { accountId }) as Promise<ApiKeyRecord[]>,
    refresh: (accountId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.keys.refresh, { accountId }) as Promise<ApiKeyRecord[]>,
    reveal: (accountId: string, tokenId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.keys.reveal, { accountId, tokenId }) as Promise<string>,
    captureAll: (accountId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.keys.captureAll, { accountId }) as Promise<CaptureKeysResult>,
  },
  models: {
    listByAccount: (accountId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.models.listByAccount, { accountId }) as Promise<ModelRecord[]>,
  },
  logs: {
    listByAccount: (accountId: string, query: UsageLogQuery) =>
      ipcRenderer.invoke(IPC_CHANNELS.logs.listByAccount, { accountId, ...query }) as Promise<UsageLogPage>,
  },
  apiTest: {
    runText: (input: RunTextApiTestInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.apiTest.runText, input) as Promise<TextApiTestResult>,
  },
  network: {
    getSettings: () =>
      ipcRenderer.invoke(IPC_CHANNELS.network.getSettings, {}) as Promise<NetworkSettingsView>,
    updateSettings: (input: UpdateNetworkSettingsInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.network.updateSettings, input) as Promise<NetworkSettingsView>,
  },
  pages: {
    openInApp: (accountId: string, page: KnownPage) =>
      ipcRenderer.invoke(IPC_CHANNELS.pages.openInApp, { accountId, page }) as Promise<void>,
    openExternal: (accountId: string, page: KnownPage) =>
      ipcRenderer.invoke(IPC_CHANNELS.pages.openExternal, { accountId, page }) as Promise<void>,
    closeEmbedded: () => ipcRenderer.invoke(IPC_CHANNELS.pages.closeEmbedded, {}) as Promise<void>,
    reportContentBounds: (bounds: ViewBounds) =>
      ipcRenderer.invoke(IPC_CHANNELS.pages.reportContentBounds, bounds) as Promise<void>,
    onLoadStateChange: (listener: (state: EmbeddedPageLoadState) => void) => {
      // 仅转发结构化加载态，不透传原始 Electron 事件对象。
      const channelListener = (_event: unknown, state: EmbeddedPageLoadState): void => listener(state);
      ipcRenderer.on(IPC_CHANNELS.pages.loadingChanged, channelListener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.pages.loadingChanged, channelListener);
    },
  },
};

contextBridge.exposeInMainWorld('apinest', bridge);

declare global {
  interface Window {
    apinest: ApiNestBridge;
  }
}
