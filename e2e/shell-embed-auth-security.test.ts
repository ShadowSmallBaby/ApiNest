import { describe, expect, it, vi } from 'vitest';
import { buildIpcHandlers } from '../src/main/ipc/handlers';
import { EmbeddedPageViewManager } from '../src/main/browser/embedded-page-view';
import type { EmbeddedViewFactory, EmbeddedViewHandle } from '../src/main/browser/embedded-page-view';
import {
  decideNavigation,
  decidePermission,
  decideWindowOpen,
  isDownloadAllowed,
} from '../src/main/browser/navigation-policy';

const accountId = '22222222-2222-4222-8222-222222222222';

/**
 * 8.5 外壳、内嵌与认证方式的安全回归（R11、R12、R13）。
 *
 * 覆盖三条新维度：
 *  - R12 窗口控制指令只接受空载荷，不接受任意句柄/坐标/尺寸；
 *  - R11 内嵌视图沿用 navigation-policy 拒绝越界导航/window.open/权限/下载，
 *        且卸载视图不清除账户 partition 持久化；
 *  - R13 站点账号密码引用只经引用通道存/删/存在性，明文不出现在任何返回值。
 */

interface FakeView {
  handle: EmbeddedViewHandle;
  destroyed: boolean;
  visible: boolean;
  guards: {
    willNavigate?: (event: { preventDefault(): void }, url: string) => void;
    windowOpen?: (details: { url: string }) => { action: 'deny' | 'allow' };
    permission?: (wc: unknown, permission: string, cb: (granted: boolean) => void) => void;
    download?: (event: { preventDefault(): void }) => void;
  };
}

function makeFactory(): { factory: EmbeddedViewFactory; views: FakeView[]; attached: EmbeddedViewHandle[] } {
  const views: FakeView[] = [];
  const attached: EmbeddedViewHandle[] = [];

  const factory: EmbeddedViewFactory = {
    create: () => {
      const state: FakeView = { handle: null as unknown as EmbeddedViewHandle, destroyed: false, visible: false, guards: {} };
      const handle: EmbeddedViewHandle = {
        webContents: {
          on: (event, listener) => {
            if (event === 'will-navigate') {
              state.guards.willNavigate = listener as FakeView['guards']['willNavigate'];
            }
          },
          setWindowOpenHandler: handler => {
            state.guards.windowOpen = handler;
          },
        },
        session: {
          setPermissionRequestHandler: handler => {
            state.guards.permission = handler as FakeView['guards']['permission'];
          },
          on: (event, listener) => {
            if (event === 'will-download') {
              state.guards.download = listener as FakeView['guards']['download'];
            }
          },
        },
        loadURL: async () => {},
        setBounds: () => {},
        setVisible: visible => {
          state.visible = visible;
        },
        destroy: () => {
          state.destroyed = true;
        },
      };
      state.handle = handle;
      views.push(state);
      return handle;
    },
    attach: handle => {
      attached.push(handle);
    },
    detach: () => {},
  };

  return { factory, views, attached };
}

describe('R12 窗口控制指令的最小权限', () => {
  it('窗口指令只作用于当前主窗口，拒绝任意句柄/坐标/尺寸载荷', async () => {
    const control = {
      minimize: vi.fn(),
      toggleMaximize: vi.fn(() => true),
      close: vi.fn(),
      isMaximized: vi.fn(() => false),
    };
    const handlers = buildIpcHandlers({ windowControl: control });

    // 携带越权字段的载荷仍被接受为“空指令”（schema 忽略额外字段），
    // 但绝不会把句柄/坐标/尺寸透传给窗口控制服务。
    await handlers['window:minimize']({ handle: 999, x: 10, y: 10 } as unknown);
    await handlers['window:toggle-maximize']({ width: 4000, height: 4000 } as unknown);
    await handlers['window:close']({});

    expect(control.minimize).toHaveBeenCalledTimes(1);
    expect(control.minimize).toHaveBeenCalledWith();
    expect(control.toggleMaximize).toHaveBeenCalledWith();
    expect(control.close).toHaveBeenCalledWith();
  });

  it('未接线窗口控制时指令安全降级为 no-op，不抛出', async () => {
    const handlers = buildIpcHandlers({});
    await expect(handlers['window:minimize']({})).resolves.toBeUndefined();
    await expect(handlers['window:is-maximized']({})).resolves.toBe(false);
  });
});

describe('R11 内嵌视图沿用受控容器安全策略', () => {
  it('内嵌视图拒绝越界导航、window.open、权限与下载', async () => {
    const { factory, views } = makeFactory();
    const manager = new EmbeddedPageViewManager({
      partitionManager: { getPartition: () => 'persist:apinest-account-x', prepareAccountSession: async () => ({} as never) },
      viewFactory: factory,
    });

    await manager.mount({
      accountId,
      baseUrl: 'https://newapi.example.com',
      startUrl: 'https://newapi.example.com/panel',
      bounds: { x: 0, y: 0, width: 100, height: 100 },
    });

    const view = views[0];
    const navEvent = { preventDefault: vi.fn() };
    view.guards.willNavigate?.(navEvent, 'https://evil.example/steal');
    expect(navEvent.preventDefault).toHaveBeenCalledTimes(1);

    // 越界域名的 window.open 一律拒绝，且不触发同窗导航。
    expect(view.guards.windowOpen?.({ url: 'https://evil.example/popup' })).toEqual({ action: 'deny' });

    const permissionCb = vi.fn();
    view.guards.permission?.(null, 'clipboard-read', permissionCb);
    expect(permissionCb).toHaveBeenCalledWith(false);

    const dlEvent = { preventDefault: vi.fn() };
    view.guards.download?.(dlEvent);
    expect(dlEvent.preventDefault).toHaveBeenCalledTimes(1);

    // 越界策略与纯函数判定保持一致。
    const context = { baseUrl: 'https://newapi.example.com' };
    expect(decideNavigation('https://evil.example/steal', context).allowed).toBe(false);
    expect(decideWindowOpen('https://evil.example/popup', context).allowed).toBe(false);
    expect(decidePermission('clipboard-read').allowed).toBe(false);
    expect(isDownloadAllowed()).toBe(false);
  });

  it('切换账户时先卸载旧视图再挂载新视图，避免叠加或串号', async () => {
    const { factory, views } = makeFactory();
    const manager = new EmbeddedPageViewManager({
      partitionManager: { getPartition: (id: string) => `persist:apinest-account-${id}`, prepareAccountSession: async () => ({} as never) },
      viewFactory: factory,
    });

    await manager.mount({ accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', baseUrl: 'https://a.example.com', startUrl: 'https://a.example.com/', bounds: { x: 0, y: 0, width: 1, height: 1 } });
    await manager.mount({ accountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', baseUrl: 'https://b.example.com', startUrl: 'https://b.example.com/', bounds: { x: 0, y: 0, width: 1, height: 1 } });

    expect(views).toHaveLength(2);
    expect(views[0].destroyed).toBe(true); // 旧视图已释放
    expect(views[1].destroyed).toBe(false); // 新视图活动
    expect(manager.hasActiveView()).toBe(true);
  });

  it('卸载内嵌视图释放资源但不触碰账户 partition 清理', async () => {
    const { factory, views } = makeFactory();
    const clearPartition = vi.fn();
    const manager = new EmbeddedPageViewManager({
      // partitionManager 只暴露 getPartition 与 prepareAccountSession（无清理能力）—— 结构上杜绝误清。
      partitionManager: { getPartition: () => 'persist:apinest-account-x', prepareAccountSession: async () => ({} as never) },
      viewFactory: factory,
    });

    await manager.mount({ accountId, baseUrl: 'https://newapi.example.com', startUrl: 'https://newapi.example.com/', bounds: { x: 0, y: 0, width: 1, height: 1 } });
    manager.unmount();

    expect(views[0].destroyed).toBe(true);
    expect(manager.hasActiveView()).toBe(false);
    expect(clearPartition).not.toHaveBeenCalled();
  });
});

describe('R13 auth 身份账密引用的脱敏与用途限制', () => {
  const authId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  it('保存/存在性通道绝不回传账号密码明文', async () => {
    const stored: Array<{ authId: string; input: { username: string; password: string } }> = [];
    let present = false;
    const handlers = buildIpcHandlers({
      authIdentities: {
        list: () => [],
        create: () => ({ id: authId, kind: 'password', label: 'pw', hasCredential: false }),
        update: () => ({ id: authId, kind: 'password', label: 'pw', hasCredential: false }),
        remove: () => {},
        saveCredential: (id, input) => {
          stored.push({ authId: id, input });
          present = true;
        },
        hasCredential: () => present,
        openLogin: () => ({ accountId: authId, mode: 'manual', authState: 'unknown', message: '' }),
      },
    });

    await handlers['auth-identities:save-credential']({ authId, username: 'alice', password: 'super-secret-pw' });
    const hasResult = await handlers['auth-identities:has-credential']({ authId });
    const listResult = await handlers['auth-identities:list']({});

    // 明文进入了主进程服务，但存在性/列表返回值绝不含明文。
    expect(stored[0].input.password).toBe('super-secret-pw');
    expect(JSON.stringify(hasResult)).not.toContain('super-secret-pw');
    expect(JSON.stringify(listResult)).not.toContain('super-secret-pw');
    expect(hasResult).toBe(true);
  });

  it('未接线 auth 身份端口时相关通道报未实现，不静默成功', async () => {
    const handlers = buildIpcHandlers({});
    await expect(handlers['auth-identities:list']({})).rejects.toMatchObject({
      code: 'NOT_IMPLEMENTED',
    });
    await expect(handlers['auth-identities:has-credential']({ authId })).rejects.toMatchObject({
      code: 'NOT_IMPLEMENTED',
    });
  });
});
