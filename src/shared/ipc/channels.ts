export const IPC_CHANNELS = {
  sites: {
    list: 'sites:list',
    get: 'sites:get',
    create: 'sites:create',
    update: 'sites:update',
    remove: 'sites:remove',
    detectPlatform: 'sites:detect-platform',
    addAccount: 'sites:add-account',
    syncAccounts: 'sites:sync-accounts',
    checkInAccounts: 'sites:checkin-accounts',
  },
  accounts: {
    list: 'accounts:list',
    create: 'accounts:create',
    update: 'accounts:update',
    copy: 'accounts:copy',
    remove: 'accounts:remove',
    refresh: 'accounts:refresh',
    getCapabilities: 'accounts:get-capabilities',
    getSnapshots: 'accounts:get-snapshots',
    linkAuth: 'accounts:link-auth',
  },
  dashboard: {
    getOverview: 'dashboard:get-overview',
  },
  auth: {
    status: 'auth:status',
    unlock: 'auth:unlock',
    lock: 'auth:lock',
    openLogin: 'auth:open-login',
    clearSession: 'auth:clear-session',
  },
  authIdentities: {
    list: 'auth-identities:list',
    create: 'auth-identities:create',
    update: 'auth-identities:update',
    remove: 'auth-identities:remove',
    saveCredential: 'auth-identities:save-credential',
    hasCredential: 'auth-identities:has-credential',
    openLogin: 'auth-identities:open-login',
  },
  checkIn: {
    runOne: 'checkin:run-one',
    runAll: 'checkin:run-all',
  },
  keys: {
    listByAccount: 'keys:list-by-account',
    reveal: 'keys:reveal',
  },
  models: {
    listByAccount: 'models:list-by-account',
  },
  logs: {
    listByAccount: 'logs:list-by-account',
  },
  apiTest: {
    runText: 'api-test:run-text',
  },
  network: {
    getSettings: 'network:get-settings',
    updateSettings: 'network:update-settings',
  },
  pages: {
    openInApp: 'pages:open-in-app',
    openExternal: 'pages:open-external',
    closeEmbedded: 'pages:close-embedded',
    reportContentBounds: 'pages:report-content-bounds',
    /** main→renderer：内嵌页加载态变化，用于工具栏/首屏等待提示。 */
    loadingChanged: 'pages:loading-changed',
  },
  window: {
    minimize: 'window:minimize',
    toggleMaximize: 'window:toggle-maximize',
    close: 'window:close',
    isMaximized: 'window:is-maximized',
    /** main→renderer 事件：最大化状态变化，用于同步自绘按钮图标。 */
    maximizeChanged: 'window:maximize-changed',
  },
} as const;

export type IpcChannelGroup = typeof IPC_CHANNELS;
