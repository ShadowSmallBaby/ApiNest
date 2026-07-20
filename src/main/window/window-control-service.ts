/**
 * 无边框主窗口的窗口控制服务（薄接线）。
 *
 * 只暴露固定枚举动作：最小化、最大化/还原、关闭、查询最大化状态。
 * 不接受任意窗口句柄、坐标或尺寸参数，杜绝被内嵌第三方页面滥用为窗口操纵能力。
 */

/** 本服务实际用到的 BrowserWindow 最小子集。 */
export interface ControllableWindow {
  isMaximized(): boolean;
  minimize(): void;
  maximize(): void;
  unmaximize(): void;
  close(): void;
  isDestroyed(): boolean;
}

export interface WindowControlServiceDependencies {
  /** 解析当前主窗口；窗口不存在或已销毁时返回 null。 */
  getWindow: () => ControllableWindow | null;
}

export class WindowControlService {
  constructor(private readonly deps: WindowControlServiceDependencies) {}

  minimize(): void {
    this.withWindow(window => window.minimize());
  }

  /** 切换最大化/还原，返回切换后的最大化状态（供自绘按钮同步图标）。 */
  toggleMaximize(): boolean {
    const window = this.resolveWindow();
    if (!window) {
      return false;
    }

    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }

    return window.isMaximized();
  }

  close(): void {
    this.withWindow(window => window.close());
  }

  isMaximized(): boolean {
    return this.resolveWindow()?.isMaximized() ?? false;
  }

  private withWindow(action: (window: ControllableWindow) => void): void {
    const window = this.resolveWindow();
    if (window) {
      action(window);
    }
  }

  private resolveWindow(): ControllableWindow | null {
    const window = this.deps.getWindow();
    if (!window || window.isDestroyed()) {
      return null;
    }

    return window;
  }
}
