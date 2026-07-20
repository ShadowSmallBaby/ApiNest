import { describe, expect, it, vi } from 'vitest';
import type {
  BrowserWindowFactory,
  ControlledSessionLike,
  ControlledWebContentsLike,
  ControlledWindowHandle,
} from './browser-container';
import { ControlledBrowserContainer } from './browser-container';

function createHarness() {
  let navigateHandler: ((event: { preventDefault(): void }, url: string) => void) | undefined;
  let windowOpenHandler: ((details: { url: string }) => { action: 'deny' | 'allow' }) | undefined;
  let failLoadHandler:
    | ((
        event: unknown,
        errorCode: number,
        errorDescription: string,
        validatedURL: string,
        isMainFrame: boolean,
      ) => void)
    | undefined;
  let permissionHandler:
    | ((webContents: Electron.WebContents, permission: string, callback: (granted: boolean) => void) => void)
    | null
    | undefined;
  let downloadHandler: ((event: { preventDefault(): void }) => void) | undefined;
  let closedHandler: (() => void) | undefined;
  const loadURL = vi.fn(async () => {});
  const show = vi.fn();
  const create = vi.fn((_options: Electron.BrowserWindowConstructorOptions): ControlledWindowHandle => ({
    webContents: {
      on: (event, listener) => {
        if (event === 'will-navigate') {
          navigateHandler = listener as (event: { preventDefault(): void }, url: string) => void;
        } else if (event === 'did-fail-load') {
          failLoadHandler = listener as (
            event: unknown,
            errorCode: number,
            errorDescription: string,
            validatedURL: string,
            isMainFrame: boolean,
          ) => void;
        }
      },
      setWindowOpenHandler: handler => {
        windowOpenHandler = handler;
      },
      getURL: () => '',
      executeJavaScript: async () => undefined,
      isDestroyed: () => false,
    } satisfies ControlledWebContentsLike,
    session: {
      setPermissionRequestHandler: handler => {
        permissionHandler = handler;
      },
      on: (_event, listener) => {
        downloadHandler = listener;
      },
    } satisfies ControlledSessionLike,
    loadURL,
    on: (_event, listener) => {
      closedHandler = listener;
    },
    show,
    destroy: vi.fn(),
  }));
  const container = new ControlledBrowserContainer({
    partitionManager: {
      getPartition: id => `persist:apinest-account-${id}`,
      prepareSessionForPartition: async () => ({} as never),
    },
    windowFactory: { create } satisfies BrowserWindowFactory,
  });

  return {
    closed: () => closedHandler?.(),
    container,
    create,
    download: (event: { preventDefault(): void }) => downloadHandler?.(event),
    failLoad: (
      errorCode: number,
      errorDescription: string,
      validatedURL: string,
      isMainFrame = true,
    ) => failLoadHandler?.(undefined, errorCode, errorDescription, validatedURL, isMainFrame),
    loadURL,
    navigate: (event: { preventDefault(): void }, url: string) => navigateHandler?.(event, url),
    permission: (permission: string, callback: (granted: boolean) => void) =>
      permissionHandler?.({} as Electron.WebContents, permission, callback),
    show,
    windowOpen: (url: string) => windowOpenHandler?.({ url }),
  };
}

describe('ControlledBrowserContainer', () => {
  it('shows immediately, loads a local status page first, then the confirmed URL', async () => {
    const test = createHarness();
    // 模拟慢网：第二次 loadURL（目标页）永不 resolve。
    let call = 0;
    test.loadURL.mockImplementation(async () => {
      call += 1;
      if (call >= 2) {
        return new Promise(() => {});
      }
    });

    await test.container.open({
      accountId: 'account-a',
      baseUrl: 'https://newapi.example.com',
      startUrl: 'https://newapi.example.com/login',
    });
    // loadTargetWithStatusPage 是 fire-and-forget；让 microtask 跑完 loading 页。
    await Promise.resolve();
    await Promise.resolve();

    expect(test.create).toHaveBeenCalledWith(expect.objectContaining({
      webPreferences: expect.objectContaining({ partition: 'persist:apinest-account-account-a' }),
    }));
    expect(test.show).toHaveBeenCalledOnce();
    // 先 loading data URL，再目标页。
    const loadedUrls = test.loadURL.mock.calls.map(call => String((call as unknown[])[0]));
    expect(loadedUrls.length).toBeGreaterThanOrEqual(2);
    expect(loadedUrls[0]).toMatch(/^data:text\/html/);
    expect(loadedUrls[1]).toBe('https://newapi.example.com/login');
    expect(test.show.mock.invocationCallOrder[0]).toBeLessThan(test.loadURL.mock.invocationCallOrder[0]);
  });

  it('replaces main-frame failures with a local error status page containing tips', async () => {
    const test = createHarness();
    await test.container.open({
      accountId: 'account-a',
      baseUrl: 'https://newapi.example.com',
      startUrl: 'https://newapi.example.com/login',
    });
    await Promise.resolve();
    await Promise.resolve();
    test.loadURL.mockClear();

    test.failLoad(-100, 'ERR_CONNECTION_CLOSED', 'https://newapi.example.com/login');
    await Promise.resolve();
    await Promise.resolve();

    expect(test.loadURL).toHaveBeenCalledOnce();
    const errorUrl = String((test.loadURL.mock.calls[0] as unknown[] | undefined)?.[0] ?? '');
    expect(errorUrl).toMatch(/^data:text\/html/);
    const html = decodeURIComponent(errorUrl.replace(/^data:text\/html;charset=utf-8,/, ''));
    expect(html).toContain('连接被关闭');
    expect(html).toContain('安全 DNS');
    expect(html).toContain('ERR_CONNECTION_CLOSED');
  });

  it('blocks unknown navigation, permissions and downloads; denies disallowed window.open', async () => {
    const test = createHarness();
    await test.container.open({
      accountId: 'account-a',
      baseUrl: 'https://newapi.example.com',
      startUrl: 'https://newapi.example.com/login',
      oauthDomains: ['connect.linux.do'],
    });
    await Promise.resolve();
    await Promise.resolve();
    const loadsAfterOpen = test.loadURL.mock.calls.length;

    const navigationEvent = { preventDefault: vi.fn() };
    test.navigate(navigationEvent, 'https://evil.example/phish');
    expect(navigationEvent.preventDefault).toHaveBeenCalledOnce();
    expect(test.windowOpen('https://evil.example/popup')).toEqual({ action: 'deny' });
    expect(test.loadURL).toHaveBeenCalledTimes(loadsAfterOpen);

    // 页内 data: 导航默认拒绝（非主进程注入）。
    const dataEvent = { preventDefault: vi.fn() };
    test.navigate(dataEvent, 'data:text/html,evil');
    expect(dataEvent.preventDefault).toHaveBeenCalledOnce();

    const permissionCallback = vi.fn();
    test.permission('geolocation', permissionCallback);
    expect(permissionCallback).toHaveBeenCalledWith(false);

    const downloadEvent = { preventDefault: vi.fn() };
    test.download(downloadEvent);
    expect(downloadEvent.preventDefault).toHaveBeenCalledOnce();
  });

  it('allows full-page navigation only to the target and explicit OAuth host, then reports close', async () => {
    const test = createHarness();
    const onClosed = vi.fn();
    await test.container.open({
      accountId: 'account-a',
      baseUrl: 'https://newapi.example.com',
      startUrl: 'https://newapi.example.com/login',
      oauthDomains: ['connect.linux.do'],
      redirectDomains: ['newapi.example.com'],
      onClosed,
    });

    const targetEvent = { preventDefault: vi.fn() };
    test.navigate(targetEvent, 'https://connect.linux.do/oauth2/authorize');
    expect(targetEvent.preventDefault).not.toHaveBeenCalled();
    test.closed();
    expect(onClosed).toHaveBeenCalledOnce();
  });

  it('handles allowed window.open as same-window loadURL and still denies a real popup', async () => {
    const test = createHarness();
    await test.container.open({
      accountId: 'account-a',
      baseUrl: 'https://newapi.example.com',
      startUrl: 'https://newapi.example.com/login',
      oauthDomains: ['connect.linux.do'],
    });
    await Promise.resolve();
    await Promise.resolve();
    test.loadURL.mockClear();

    expect(test.windowOpen('https://connect.linux.do/oauth2/authorize')).toEqual({ action: 'deny' });
    expect(test.loadURL).toHaveBeenCalledWith('https://connect.linux.do/oauth2/authorize');
  });
});
