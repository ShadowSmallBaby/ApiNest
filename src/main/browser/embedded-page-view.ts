import { SECURE_WEB_PREFERENCES } from '../window/secure-web-preferences';
import type { SessionPartitionManager } from '../auth/session-partition-manager';
import type { EmbeddedPageLoadState, NavigationErrorView } from '../../shared/ipc/bridge';
import type {
  ControlledSessionLike,
  ControlledWebContentsLike,
} from './browser-container';
import {
  describeNavigationError,
} from './browser-status-page';
import {
  AllowedNavigationContext,
  decideNavigation,
  decidePermission,
  decideWindowOpen,
  isDownloadAllowed,
} from './navigation-policy';

/**
 * 应用内嵌页面视图（R11）。
 *
 * 将目标站点页面从独立窗口改为主窗口内嵌视图（WebContentsView），
 * 覆盖在 Renderer 内容区的预留区域上，由主进程按内容区上报的 bounds 定位。
 * 安全策略与受控独立容器完全一致：复用 navigation-policy 全部纯函数判定，
 * 绑定账户专属 partition，不注入本应用 Preload，默认拒绝一切越界导航/权限/下载。
 *
 * 主进程持有“当前内嵌视图”单例：切换账户或页面时先 unmount 旧视图再 mount 新视图，
 * 避免多个视图叠加或串号。hide/unmount 释放视图资源，但不清除账户 partition 持久化会话。
 *
 * 加载反馈：首屏前隐藏原生视图，经 onLoadStateChange 向 Renderer 推送 loading/ready/error；
 * 失败时附带用户可读排查提示（如 Secure DNS + Clash TUN），原生视图保持隐藏以免盖住错误 UI。
 */

export interface ViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** WebContentsView 中本视图实际使用到的最小子集。 */
export interface EmbeddedViewHandle {
  readonly webContents: ControlledWebContentsLike;
  readonly session: ControlledSessionLike;
  loadURL(url: string): Promise<void>;
  setBounds(bounds: ViewBounds): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}

/** 视图工厂：封装 WebContentsView 的创建与向主窗口 contentView 的挂载/卸载。 */
export interface EmbeddedViewFactory {
  create(options: { partition: string }): EmbeddedViewHandle;
  attach(handle: EmbeddedViewHandle): void;
  detach(handle: EmbeddedViewHandle): void;
}

export interface MountEmbeddedViewRequest {
  accountId: string;
  baseUrl: string;
  startUrl: string;
  bounds: ViewBounds;
  oauthDomains?: string[];
  redirectDomains?: string[];
}

export interface EmbeddedPageViewDependencies {
  partitionManager: Pick<SessionPartitionManager, 'getPartition' | 'prepareAccountSession'>;
  viewFactory: EmbeddedViewFactory;
  /**
   * 加载态变化回调（主进程组合根注入，绝不进入 IPC schema 以外的通道）。
   * loading / ready / error，供 Renderer 展示转圈或排查提示。
   */
  onLoadStateChange?: (state: EmbeddedPageLoadState) => void;
}

interface ActiveView {
  handle: EmbeddedViewHandle;
  accountId: string;
  /** 当前主帧导航是否已失败；用于 did-stop-loading 时避免把 error 覆盖成 ready。 */
  loadFailed: boolean;
}

/** 用户/程序取消导航时的 Chromium 错误码，不应展示为失败。 */
const ERR_ABORTED = -3;

export class EmbeddedPageViewManager {
  private active: ActiveView | null = null;
  private lastBounds: ViewBounds | null = null;

  constructor(private readonly deps: EmbeddedPageViewDependencies) {}

  /** 挂载目标站点页面到内容区。已有视图时先卸载，保证单例、不叠加、不串号。 */
  async mount(request: MountEmbeddedViewRequest): Promise<void> {
    // 先过网络策略屏障（fail-closed）；失败则不动当前视图，保留旧状态、抛错交由上层提示。
    await this.deps.partitionManager.prepareAccountSession(request.accountId);
    this.unmount();

    const partition = this.deps.partitionManager.getPartition(request.accountId);
    const context: AllowedNavigationContext = {
      baseUrl: request.baseUrl,
      oauthDomains: request.oauthDomains,
      redirectDomains: request.redirectDomains,
    };

    const handle = this.deps.viewFactory.create({ partition });
    this.applyNavigationGuards(handle, context);
    this.bindLoadingEvents(handle, request.startUrl);
    this.deps.viewFactory.attach(handle);
    handle.setBounds(request.bounds);
    // 首屏加载完成前保持隐藏：原生 WebContentsView 会盖住 renderer DOM，
    // 隐藏期间由工具栏/覆盖层充当等待或错误反馈；成功后再显示。
    handle.setVisible(false);

    this.active = { handle, accountId: request.accountId, loadFailed: false };
    this.lastBounds = request.bounds;

    // 主动推一次 loading，覆盖 did-start-loading 尚未触发的竞态窗口。
    this.emitLoadState({ status: 'loading' });
    // 加载失败时由 did-fail-load 推送 error；此处吞掉 rejection 避免 UnhandledPromiseRejection。
    void handle.loadURL(request.startUrl).catch(() => {
      // did-fail-load 通常会先到；若未到则兜底一条通用错误，避免永远转圈。
      if (this.active?.handle === handle && !this.active.loadFailed) {
        this.active.loadFailed = true;
        this.emitLoadState({
          status: 'error',
          error: toErrorView(
            describeNavigationError(-2, 'ERR_FAILED', request.startUrl),
          ),
        });
      }
    });
  }

  /** 更新内嵌视图几何，使其精确贴合内容区。无活动视图时记忆最近 bounds。 */
  setBounds(bounds: ViewBounds): void {
    this.lastBounds = bounds;
    this.active?.handle.setBounds(bounds);
  }

  /** 切换到其他导航项时隐藏但保留视图；返回时可 show 复用。 */
  hide(): void {
    this.active?.handle.setVisible(false);
  }

  /** 重新显示已隐藏的视图，并按最近 bounds 复位。 */
  show(): void {
    if (!this.active) {
      return;
    }

    if (this.lastBounds) {
      this.active.handle.setBounds(this.lastBounds);
    }
    // 错误态保持隐藏，让 Renderer 错误面板继续可见。
    if (!this.active.loadFailed) {
      this.active.handle.setVisible(true);
    }
  }

  /** 卸载并释放视图资源；不清除账户 partition 的持久化会话。 */
  unmount(): void {
    if (!this.active) {
      return;
    }

    const { handle } = this.active;
    this.active = null;
    // 卸载时复位加载态，避免离开页面后工具栏仍显示转圈/错误。
    this.emitLoadState({ status: 'ready' });
    this.deps.viewFactory.detach(handle);
    handle.destroy();
  }

  /** 当前是否有活动内嵌视图（供接线层判断）。 */
  hasActiveView(): boolean {
    return this.active !== null;
  }

  private emitLoadState(state: EmbeddedPageLoadState): void {
    this.deps.onLoadStateChange?.(state);
  }

  /**
   * 绑定加载/失败事件。
   * - loading：开始导航；
   * - ready：主帧成功结束 → 显示原生视图；
   * - error：主帧失败 → 保持隐藏并推送排查提示。
   * 仅对当前 active handle 生效，避免旧视图晚到事件串扰。
   */
  private bindLoadingEvents(handle: EmbeddedViewHandle, startUrl: string): void {
    handle.webContents.on('did-start-loading', () => {
      if (this.active?.handle !== handle) {
        return;
      }
      this.active.loadFailed = false;
      handle.setVisible(false);
      this.emitLoadState({ status: 'loading' });
    });

    handle.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (this.active?.handle !== handle || !isMainFrame) {
          return;
        }
        if (errorCode === ERR_ABORTED) {
          return;
        }
        this.active.loadFailed = true;
        handle.setVisible(false);
        const failedUrl = validatedURL || startUrl;
        this.emitLoadState({
          status: 'error',
          error: toErrorView(describeNavigationError(errorCode, errorDescription, failedUrl)),
        });
      },
    );

    handle.webContents.on('did-stop-loading', () => {
      if (this.active?.handle !== handle) {
        return;
      }
      // 失败路径已由 did-fail-load 处理；此处只确认成功态。
      if (this.active.loadFailed) {
        return;
      }
      handle.setVisible(true);
      this.emitLoadState({ status: 'ready' });
    });
  }

  private applyNavigationGuards(
    handle: EmbeddedViewHandle,
    context: AllowedNavigationContext,
  ): void {
    handle.webContents.on('will-navigate', (event, url) => {
      if (!decideNavigation(url, context).allowed) {
        event.preventDefault();
      }
    });

    // 允许集内的 window.open / target=_blank 改为同窗导航，避免无守卫子窗。
    handle.webContents.setWindowOpenHandler(details => {
      if (!decideWindowOpen(details.url, context).allowed) {
        return { action: 'deny' };
      }
      // 同窗导航；加载失败时由 did-fail-load 推送 error，吞掉 rejection。
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

/** 领域错误信息 → IPC 安全视图（字段一一对应，无额外敏感数据）。 */
function toErrorView(info: {
  code: number;
  description: string;
  url: string;
  title: string;
  message: string;
  tips: string[];
}): NavigationErrorView {
  return {
    code: info.code,
    description: info.description,
    url: info.url,
    title: info.title,
    message: info.message,
    tips: info.tips,
  };
}

/** 导出安全基线，供组合根创建 WebContentsView 时复用。 */
export const EMBEDDED_VIEW_WEB_PREFERENCES: Electron.WebPreferences = {
  ...SECURE_WEB_PREFERENCES,
  // 内嵌站点页绝不注入本应用 preload。
};
