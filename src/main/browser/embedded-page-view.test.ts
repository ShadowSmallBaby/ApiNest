import { describe, expect, it } from 'vitest';
import { EmbeddedPageViewManager } from './embedded-page-view';
import type {
  EmbeddedViewFactory,
  EmbeddedViewHandle,
  MountEmbeddedViewRequest,
  ViewBounds,
} from './embedded-page-view';
import type { EmbeddedPageLoadState } from '../../shared/ipc/bridge';

interface FakeWebContents {
  navigateListener?: (event: { preventDefault(): void }, url: string) => void;
  startLoadingListener?: () => void;
  stopLoadingListener?: () => void;
  failLoadListener?: (
    event: unknown,
    errorCode: number,
    errorDescription: string,
    validatedURL: string,
    isMainFrame: boolean,
  ) => void;
  windowOpenHandler?: (details: { url: string }) => { action: 'deny' | 'allow' };
  on(
    event: 'will-navigate' | 'did-start-loading' | 'did-stop-loading' | 'did-fail-load',
    listener: unknown,
  ): void;
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' | 'allow' }): void;
  getURL(): string;
  executeJavaScript(code: string): Promise<unknown>;
  isDestroyed(): boolean;
}

interface FakeSession {
  permissionHandler?: (
    webContents: Electron.WebContents,
    permission: string,
    callback: (granted: boolean) => void,
  ) => void;
  downloadListener?: (event: { preventDefault(): void }) => void;
  setPermissionRequestHandler(handler: FakeSession['permissionHandler'] | null): void;
  on(event: 'will-download', listener: (event: { preventDefault(): void }) => void): void;
}

interface FakeHandle extends EmbeddedViewHandle {
  webContents: FakeWebContents;
  session: FakeSession;
  loadedUrls: string[];
  boundsHistory: ViewBounds[];
  visibility: boolean[];
  destroyed: boolean;
}

function createFakeHandle(): FakeHandle {
  const webContents: FakeWebContents = {
    on(event, listener) {
      if (event === 'will-navigate') {
        this.navigateListener = listener as (event: { preventDefault(): void }, url: string) => void;
      } else if (event === 'did-start-loading') {
        this.startLoadingListener = listener as () => void;
      } else if (event === 'did-stop-loading') {
        this.stopLoadingListener = listener as () => void;
      } else if (event === 'did-fail-load') {
        this.failLoadListener = listener as (
          event: unknown,
          errorCode: number,
          errorDescription: string,
          validatedURL: string,
          isMainFrame: boolean,
        ) => void;
      }
    },
    setWindowOpenHandler(handler) {
      this.windowOpenHandler = handler;
    },
    getURL() {
      return '';
    },
    executeJavaScript: async () => undefined,
    isDestroyed() {
      return false;
    },
  };
  const session: FakeSession = {
    setPermissionRequestHandler(handler) {
      this.permissionHandler = handler ?? undefined;
    },
    on(_event, listener) {
      this.downloadListener = listener;
    },
  };

  return {
    webContents,
    session,
    loadedUrls: [],
    boundsHistory: [],
    visibility: [],
    destroyed: false,
    async loadURL(url: string) {
      this.loadedUrls.push(url);
    },
    setBounds(bounds: ViewBounds) {
      this.boundsHistory.push(bounds);
    },
    setVisible(visible: boolean) {
      this.visibility.push(visible);
    },
    destroy() {
      this.destroyed = true;
    },
  };
}

function createFactory(): { factory: EmbeddedViewFactory; created: FakeHandle[]; attached: FakeHandle[]; detached: FakeHandle[] } {
  const created: FakeHandle[] = [];
  const attached: FakeHandle[] = [];
  const detached: FakeHandle[] = [];
  const factory: EmbeddedViewFactory = {
    create() {
      const handle = createFakeHandle();
      created.push(handle);
      return handle;
    },
    attach(handle) {
      attached.push(handle as FakeHandle);
    },
    detach(handle) {
      detached.push(handle as FakeHandle);
    },
  };

  return { factory, created, attached, detached };
}

const PARTITIONS = new Map<string, string>();
const partitionManager = {
  getPartition(accountId: string): string {
    const partition = `persist:apinest-account-${accountId}`;
    PARTITIONS.set(accountId, partition);
    return partition;
  },
  async prepareAccountSession() {
    return {} as never;
  },
};

const BASE_REQUEST: MountEmbeddedViewRequest = {
  accountId: 'acc-a',
  baseUrl: 'https://site-a.example.com',
  startUrl: 'https://site-a.example.com/panel',
  bounds: { x: 240, y: 40, width: 800, height: 600 },
};

describe('EmbeddedPageViewManager', () => {
  it('mounts a view: attaches, sets bounds, starts hidden, and loads the start URL', async () => {
    const { factory, created, attached } = createFactory();
    const manager = new EmbeddedPageViewManager({ partitionManager, viewFactory: factory });

    await manager.mount(BASE_REQUEST);

    expect(created).toHaveLength(1);
    expect(attached).toHaveLength(1);
    expect(created[0].boundsHistory[0]).toEqual(BASE_REQUEST.bounds);
    // 首屏完成前保持隐藏，避免原生视图盖住 renderer 的加载提示。
    expect(created[0].visibility).toEqual([false]);
    expect(created[0].loadedUrls).toEqual(['https://site-a.example.com/panel']);
    expect(manager.hasActiveView()).toBe(true);
  });

  it('reports loading then ready, and reveals the view after did-stop-loading', async () => {
    const { factory, created } = createFactory();
    const states: EmbeddedPageLoadState[] = [];
    const manager = new EmbeddedPageViewManager({
      partitionManager,
      viewFactory: factory,
      onLoadStateChange: value => states.push(value),
    });

    await manager.mount(BASE_REQUEST);
    const handle = created[0];

    expect(states).toEqual([{ status: 'loading' }]);
    handle.webContents.startLoadingListener?.();
    expect(states.at(-1)).toEqual({ status: 'loading' });

    handle.webContents.stopLoadingListener?.();
    expect(states.at(-1)).toEqual({ status: 'ready' });
    expect(handle.visibility.at(-1)).toBe(true);

    manager.unmount();
    // 卸载复位为 ready，避免工具栏残留转圈。
    expect(states.at(-1)).toEqual({ status: 'ready' });
  });

  it('reports structured error on main-frame failure and keeps the native view hidden', async () => {
    const { factory, created } = createFactory();
    const states: EmbeddedPageLoadState[] = [];
    const manager = new EmbeddedPageViewManager({
      partitionManager,
      viewFactory: factory,
      onLoadStateChange: value => states.push(value),
    });

    await manager.mount(BASE_REQUEST);
    const handle = created[0];

    handle.webContents.failLoadListener?.(
      undefined,
      -100,
      'ERR_CONNECTION_CLOSED',
      'https://site-a.example.com/panel',
      true,
    );

    const last = states.at(-1);
    expect(last?.status).toBe('error');
    if (last?.status === 'error') {
      expect(last.error.description).toBe('ERR_CONNECTION_CLOSED');
      expect(last.error.title).toContain('连接');
      expect(last.error.tips.some(tip => tip.includes('安全 DNS'))).toBe(true);
    }
    expect(handle.visibility.at(-1)).toBe(false);

    // 失败后再 stop-loading 不得覆盖为 ready / 显示原生视图。
    handle.webContents.stopLoadingListener?.();
    expect(states.at(-1)?.status).toBe('error');
    expect(handle.visibility.at(-1)).toBe(false);
  });

  it('is a singleton: mounting a second view unmounts and destroys the first', async () => {
    const { factory, created, detached } = createFactory();
    const manager = new EmbeddedPageViewManager({ partitionManager, viewFactory: factory });

    await manager.mount(BASE_REQUEST);
    await manager.mount({
      ...BASE_REQUEST,
      accountId: 'acc-b',
      baseUrl: 'https://site-b.example.com',
      startUrl: 'https://site-b.example.com/panel',
    });

    expect(created).toHaveLength(2);
    expect(created[0].destroyed).toBe(true);
    expect(detached[0]).toBe(created[0]);
    expect(created[1].destroyed).toBe(false);
  });

  it('reuses navigation-policy: blocks disallowed navigation, allows the target host', async () => {
    const { factory, created } = createFactory();
    const manager = new EmbeddedPageViewManager({ partitionManager, viewFactory: factory });
    await manager.mount(BASE_REQUEST);

    const handle = created[0];
    let prevented = false;
    handle.webContents.navigateListener?.({ preventDefault: () => (prevented = true) }, 'https://evil.example.com/steal');
    expect(prevented).toBe(true);

    prevented = false;
    handle.webContents.navigateListener?.({ preventDefault: () => (prevented = true) }, 'https://site-a.example.com/other');
    expect(prevented).toBe(false);
  });

  it('handles allowed window.open as same-window loadURL; denies permissions and downloads', async () => {
    const { factory, created } = createFactory();
    const manager = new EmbeddedPageViewManager({ partitionManager, viewFactory: factory });
    await manager.mount(BASE_REQUEST);

    const handle = created[0];
    // 允许 host：仍 deny 新窗，但同窗 loadURL。
    expect(handle.webContents.windowOpenHandler?.({ url: 'https://site-a.example.com/popup' })).toEqual({ action: 'deny' });
    expect(handle.loadedUrls).toContain('https://site-a.example.com/popup');
    // 策略外 host：deny 且不 load。
    const before = handle.loadedUrls.length;
    expect(handle.webContents.windowOpenHandler?.({ url: 'https://evil.example.com/popup' })).toEqual({ action: 'deny' });
    expect(handle.loadedUrls).toHaveLength(before);

    let granted = true;
    handle.session.permissionHandler?.({} as Electron.WebContents, 'media', value => (granted = value));
    expect(granted).toBe(false);

    let downloadPrevented = false;
    handle.session.downloadListener?.({ preventDefault: () => (downloadPrevented = true) });
    expect(downloadPrevented).toBe(true);
  });

  it('hide keeps the view; show re-applies last bounds and re-shows when not in error', async () => {
    const { factory, created } = createFactory();
    const manager = new EmbeddedPageViewManager({ partitionManager, viewFactory: factory });
    await manager.mount(BASE_REQUEST);
    const handle = created[0];
    // 模拟加载成功后再 hide/show。
    handle.webContents.stopLoadingListener?.();

    manager.hide();
    expect(handle.visibility).toContain(false);
    expect(manager.hasActiveView()).toBe(true);

    manager.setBounds({ x: 260, y: 48, width: 900, height: 700 });
    manager.show();
    expect(handle.boundsHistory.at(-1)).toEqual({ x: 260, y: 48, width: 900, height: 700 });
    expect(handle.visibility.at(-1)).toBe(true);
  });

  it('unmount releases the view without clearing the account partition', async () => {
    const { factory, created, detached } = createFactory();
    const manager = new EmbeddedPageViewManager({ partitionManager, viewFactory: factory });
    await manager.mount(BASE_REQUEST);

    manager.unmount();

    expect(created[0].destroyed).toBe(true);
    expect(detached[0]).toBe(created[0]);
    expect(manager.hasActiveView()).toBe(false);
    // partition 由 partitionManager 持久化派生，卸载视图不触碰其存储。
    expect(PARTITIONS.get('acc-a')).toBe('persist:apinest-account-acc-a');
  });

  it('setBounds before mount is remembered and applied on next mount is not required, but no crash', () => {
    const { factory } = createFactory();
    const manager = new EmbeddedPageViewManager({ partitionManager, viewFactory: factory });
    expect(() => manager.setBounds({ x: 0, y: 0, width: 100, height: 100 })).not.toThrow();
    expect(() => manager.unmount()).not.toThrow();
  });
});
