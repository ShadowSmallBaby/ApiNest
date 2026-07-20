import { join } from 'node:path';

/**
 * 主窗口与受控容器共享的安全 Renderer 默认值。
 * 单一事实来源，避免多处窗口配置漂移。
 */
export const SECURE_WEB_PREFERENCES: Electron.WebPreferences = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
};

/** 主窗口专用：在安全基线上附加本应用受限 preload。 */
export function getMainWindowWebPreferences(): Electron.WebPreferences {
  return {
    ...SECURE_WEB_PREFERENCES,
    preload: join(__dirname, '../preload/index.js'),
  };
}
