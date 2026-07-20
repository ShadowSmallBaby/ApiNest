/**
 * 受控内嵌浏览器容器（薄 Electron 接线，安全判定全部委托 navigation-policy 纯函数）。
 *
 * 仅主进程可创建 / 销毁。绑定账户专属 partition，加载目标站点页面时不注入本应用 preload，
 * 防止第三方页面触达本地 IPC；所有导航、window.open、权限、下载默认拒绝。
 *
 * 加载体验：先展示本地 loading 状态页再导航目标 URL；主帧失败时展示带排查提示的错误页
 * （覆盖 Secure DNS + Clash TUN 等常见场景），避免原生空白页让用户无从下手。
 */

import { SECURE_WEB_PREFERENCES } from '../window/secure-web-preferences';
import type { SessionPartitionManager } from '../auth/session-partition-manager';
import {
  buildErrorStatusDataUrl,
  buildLoadingStatusDataUrl,
  describeNavigationError,
} from './browser-status-page';
import {
  AllowedNavigationContext,
  decideNavigation,
  decidePermission,
  decideWindowOpen,
  isDownloadAllowed,
} from './navigation-policy';

/** Electron `WebContents` 中本容器实际使用到的最小子集。 */
export interface ControlledWebContentsLike {
  on(
    event: 'will-navigate',
    listener: (event: { preventDefault(): void }, url: string) => void,
  ): void;
  on(event: 'did-start-loading', listener: () => void): void;
  on(event: 'did-stop-loading', listener: () => void): void;
  on(
    event: 'did-fail-load',
    listener: (
      event: unknown,
      errorCode: number,
      errorDescription: string,
      validatedURL: string,
      isMainFrame: boolean,
    ) => void,
  ): void;
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' | 'allow' }): void;
  /** 当前加载页面的 URL；用于登录窗口内按 origin 受控提取站内用户 ID。 */
  getURL(): string;
  /** 在页面上下文执行固定脚本（仅主进程内部按需调用，绝不暴露给 Renderer）。 */
  executeJavaScript(code: string): Promise<unknown>;
  isDestroyed(): boolean;
}

/** Electron `Session` 权限/下载相关最小子集。 */
export interface ControlledSessionLike {
  setPermissionRequestHandler(
    handler: ((webContents: Electron.WebContents, permission: string, callback: (granted: boolean) => void) => void) | null,
  ): void;
  on(event: 'will-download', listener: (event: { preventDefault(): void }) => void): void;
}

export interface ControlledWindowHandle {
  readonly webContents: ControlledWebContentsLike;
  readonly session: ControlledSessionLike;
  loadURL(url: string): Promise<void>;
  on(event: 'closed', listener: () => void): void;
  show(): void;
  destroy(): void;
}

export interface BrowserWindowFactory {
  create(options: Electron.BrowserWindowConstructorOptions): ControlledWindowHandle;
}

export interface OpenContainerRequest {
  accountId: string;
  baseUrl: string;
  startUrl: string;
  oauthDomains?: string[];
  redirectDomains?: string[];
  /**
   * 显式 partition 覆盖。缺省时按 accountId 派生账户专属 partition；
   * auth 身份登录需在 auth 专属 partition 打开 IdP 页时显式传入。
   */
  partition?: string;
  onClosed?: () => void;
  /**
   * 窗口 WebContents 就绪回调（仅主进程组合根注入，绝不进入 IPC schema）。
   * 用于在登录窗口存活期间启动站内用户 ID 的受控提取。
   */
  onWebContentsReady?: (webContents: ControlledWebContentsLike) => void;
}

export interface ControlledBrowserContainerDependencies {
  partitionManager: Pick<SessionPartitionManager, 'getPartition' | 'prepareSessionForPartition'>;
  windowFactory: BrowserWindowFactory;
}

/** 用户/程序取消导航时的 Chromium 错误码，不应展示为失败页。 */
const ERR_ABORTED = -3;

export class ControlledBrowserContainer {
  /**
   * 即将由主进程注入的 data: 状态页。
   * will-navigate 对 data: 默认拒绝，仅当 handle 在此集合中时放行（避免拦下自己的 loading/error 页）。
   */
  private readonly pendingStatusLoads = new WeakSet<ControlledWindowHandle>();

  constructor(private readonly deps: ControlledBrowserContainerDependencies) {}

  async open(request: OpenContainerRequest): Promise<ControlledWindowHandle> {
    // 显式 partition 优先（auth 身份登录用 auth 专属 partition）；缺省按 accountId 派生。
    const partition = request.partition ?? this.deps.partitionManager.getPartition(request.accountId);
    // 首个导航前的网络策略屏障：失败即 fail-closed（抛错、绝不创建可联网窗口）。
    await this.deps.partitionManager.prepareSessionForPartition(partition);
    const context: AllowedNavigationContext = {
      baseUrl: request.baseUrl,
      oauthDomains: request.oauthDomains,
      redirectDomains: request.redirectDomains,
    };

    const handle = this.deps.windowFactory.create({
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        ...SECURE_WEB_PREFERENCES,
        partition,
      },
    });

    this.applyNavigationGuards(handle, context);
    this.bindLoadFailurePage(handle, request.startUrl);
    if (request.onClosed) {
      handle.on('closed', request.onClosed);
    }
    // 在加载目标页前暴露 WebContents，供登录流程启动站内用户 ID 受控提取。
    request.onWebContentsReady?.(handle.webContents);
    // 先 show + 本地 loading 页，再导航目标：慢网下立即有反馈，失败时有排查提示。
    handle.show();
    void this.loadTargetWithStatusPage(handle, request.startUrl);

    return handle;
  }

  /**
   * 先加载本地 loading 状态页（即时可见），再导航目标 URL。
   * 任一步 rejection 由 did-fail-load / catch 兜底，避免 UnhandledPromiseRejection。
   */
  private async loadTargetWithStatusPage(
    handle: ControlledWindowHandle,
    targetUrl: string,
  ): Promise<void> {
    await this.loadStatusPage(handle, buildLoadingStatusDataUrl(targetUrl));
    if (handle.webContents.isDestroyed()) {
      return;
    }
    try {
      await handle.loadURL(targetUrl);
    } catch {
      // 目标页失败由 did-fail-load 展示错误状态页；此处仅吞掉 rejection。
    }
  }

  /** 主进程注入 data: 状态页：短暂加入白名单，使 will-navigate 放行。 */
  private async loadStatusPage(handle: ControlledWindowHandle, dataUrl: string): Promise<void> {
    this.pendingStatusLoads.add(handle);
    try {
      await handle.loadURL(dataUrl);
    } catch {
      // data URL 几乎不会失败；忽略即可。
    } finally {
      this.pendingStatusLoads.delete(handle);
    }
  }

  /**
   * 主帧加载失败时替换为带排查提示的本地错误页。
   * 忽略 ERR_ABORTED 与 data: 状态页自身的失败，避免误报或循环。
   */
  private bindLoadFailurePage(handle: ControlledWindowHandle, fallbackUrl: string): void {
    handle.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame || handle.webContents.isDestroyed()) {
          return;
        }
        if (errorCode === ERR_ABORTED) {
          return;
        }
        if (validatedURL.startsWith('data:')) {
          return;
        }
        const failedUrl = validatedURL || fallbackUrl;
        const info = describeNavigationError(errorCode, errorDescription, failedUrl);
        void this.loadStatusPage(handle, buildErrorStatusDataUrl(info));
      },
    );
  }

  private applyNavigationGuards(
    handle: ControlledWindowHandle,
    context: AllowedNavigationContext,
  ): void {
    handle.webContents.on('will-navigate', (event, url) => {
      // 本地状态页（data:）仅允许主进程注入（pendingStatusLoads）；页内跳 data: 一律拒绝。
      // 错误页「重试」通过 location.href 跳回 http(s) 目标，仍走允许集判定。
      if (url.startsWith('data:')) {
        if (!this.pendingStatusLoads.has(handle)) {
          event.preventDefault();
        }
        return;
      }
      if (!decideNavigation(url, context).allowed) {
        event.preventDefault();
      }
    });

    // 允许集内的 window.open / target=_blank 改为同窗导航，避免无守卫子窗。
    handle.webContents.setWindowOpenHandler(details => {
      if (!decideWindowOpen(details.url, context).allowed) {
        return { action: 'deny' };
      }
      // 同窗导航；加载失败时由 did-fail-load 展示错误页，吞掉 rejection。
      void handle.loadURL(details.url).catch(() => {});
      return { action: 'deny' };
    });

    handle.session.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(decidePermission(permission).allowed);
    });

    handle.session.on('will-download', event => {
      if (!isDownloadAllowed()) {
        event.preventDefault();
      }
    });
  }
}
