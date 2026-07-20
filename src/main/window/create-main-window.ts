import { BrowserWindow, app } from 'electron';
import { join } from 'node:path';
import { getMainWindowWebPreferences } from './secure-web-preferences';

// 运行时窗口图标（开发期 Windows 左上角、Linux 任务栏）。vite-plugin-electron 无 electron-vite
// 的 ?asset 语义，改为运行时按路径解析：开发期读项目内 build/ 源图标，打包后读 resources 下随
// extraResources 附带的同名文件。macOS 运行时窗口不吃 icon，只认打包 .icns，返回 undefined 即可。
const APP_ICON_RELATIVE = 'build/icons/png/512x512.png';

function resolveAppIcon(): string | undefined {
  if (process.platform === 'darwin') {
    return undefined;
  }
  // 打包后 __dirname 位于 asar 内，图标随 extraResources 落在 process.resourcesPath；
  // 开发期从 dist-electron/main 向上回到项目根定位 build/ 源图标。
  return app.isPackaged
    ? join(process.resourcesPath, APP_ICON_RELATIVE)
    : join(__dirname, '../..', APP_ICON_RELATIVE);
}

const MAIN_WINDOW_OPTIONS: Electron.BrowserWindowConstructorOptions = {
  width: 1280,
  height: 800,
  minWidth: 1024,
  minHeight: 720,
  show: false,
  autoHideMenuBar: true,
  // 无边框外壳（R12）：隐藏系统标题栏，由 Renderer 自绘顶部栏。
  // Windows/Linux 用 frame:false 完全交给自绘栏；macOS 用 hidden 保留交通灯并定位到自绘栏内。
  frame: false,
  titleBarStyle: 'hidden',
  trafficLightPosition: { x: 16, y: 18 },
  webPreferences: getMainWindowWebPreferences(),
};

/** dev server 未就绪时的重连间隔与上限（仅开发期 loadURL 生效）。 */
const DEV_RELOAD_DELAY_MS = 300;
const DEV_RELOAD_MAX_ATTEMPTS = 40;

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    ...MAIN_WINDOW_OPTIONS,
    icon: resolveAppIcon(),
  });

  window.once('ready-to-show', () => {
    window.show();
  });

  // vite-plugin-electron 不会向手动启动的 electron 子进程注入 VITE_DEV_SERVER_URL，
  // dev server 地址由 electron:dev 脚本经 cross-env 以 ELECTRON_START_URL 显式传入。
  const devUrl = !app.isPackaged ? process.env.ELECTRON_START_URL : undefined;

  if (devUrl) {
    // 首次启动时 Electron 可能抢在 Vite dev server 监听前 loadURL，导致
    // ERR_CONNECTION_REFUSED。开发期对连接失败做有限次重试，直至 dev server 就绪。
    let attempts = 0;
    const loadDevUrl = (): void => {
      void window.loadURL(devUrl);
    };
    window.webContents.on('did-fail-load', (_event, errorCode) => {
      // -102 = ERR_CONNECTION_REFUSED；仅在窗口存活且未超上限时重试。
      if (errorCode === -102 && !window.isDestroyed() && attempts < DEV_RELOAD_MAX_ATTEMPTS) {
        attempts += 1;
        setTimeout(loadDevUrl, DEV_RELOAD_DELAY_MS);
      }
    });
    loadDevUrl();
  } else {
    void window.loadFile(join(__dirname, '../../dist/index.html'));
  }

  return window;
}

export function getMainWindowOptions(): Electron.BrowserWindowConstructorOptions {
  return MAIN_WINDOW_OPTIONS;
}
