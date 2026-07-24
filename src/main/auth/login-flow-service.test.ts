import { describe, expect, it } from 'vitest';
import { AppError } from '../../shared/ipc/errors';
import type { OpenContainerRequest } from '../browser/browser-container';
import { LoginFlowService } from './login-flow-service';

const account = {
  id: '11111111-1111-4111-8111-111111111111',
  platform: 'newapi',
  baseUrl: 'https://newapi.example.com',
  displayName: 'Account A',
  linuxDoClientId: 'client-id',
  routeProfile: 'modern' as const,
  recordVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  authRefId: null as string | null,
};

type TestAccount = Omit<typeof account, 'linuxDoClientId'> & { linuxDoClientId?: string };

interface SyncCall {
  accountId: string;
  authId: string;
  kind: 'github' | 'linuxdo';
}

function createService(
  overrides: {
    account?: TestAccount | null;
    loginUrl?: URL | null;
    identity?: { id: string; kind: string } | null;
    syncThrows?: boolean;
  } = {},
) {
  const requests: OpenContainerRequest[] = [];
  let closed: (() => void) | undefined;
  const refreshes: string[] = [];
  const syncCalls: SyncCall[] = [];
  const service = new LoginFlowService({
    accountRepository: { get: () => (overrides.account === undefined ? account : overrides.account) },
    adapterRegistry: {
      get: () => ({
        getPageUrl: () =>
          overrides.loginUrl === undefined ? new URL('https://newapi.example.com/login') : overrides.loginUrl,
      }),
    } as never,
    browserContainer: {
      open: request => {
        requests.push(request);
        closed = request.onClosed;
        return {} as never;
      },
    },
    authSessionService: {
      refreshAuthState: async id => {
        refreshes.push(id);
        return 'active';
      },
    },
    authIdentityRepository: {
      get: () => (overrides.identity === undefined ? null : overrides.identity) as never,
    },
    idpCookieSync: {
      syncLinkedIdpCookies: async input => {
        syncCalls.push(input);
        if (overrides.syncThrows) {
          throw new Error('sync failed');
        }
        return { copied: 1, skipped: [] };
      },
    },
  });

  return { closed: () => closed?.(), refreshes, requests, syncCalls, service };
}

describe('LoginFlowService', () => {
  it('opens the manual login page with default GitHub + LinuxDo OAuth domains allowed', async () => {
    const test = createService();

    await expect(test.service.open(account.id, 'manual')).resolves.toMatchObject({
      accountId: account.id,
      mode: 'manual',
      authState: 'unknown',
    });
    expect(test.requests[0]).toMatchObject({
      accountId: account.id,
      baseUrl: account.baseUrl,
      startUrl: 'https://newapi.example.com/login',
      oauthDomains: ['github.com', 'connect.linux.do'],
      redirectDomains: ['newapi.example.com'],
    });
  });

  it('opens only the target site LinuxDo entry with explicit trusted hosts', async () => {
    const test = createService();

    // 无 headless 服务时 auto/linuxdo 降级为打开站点登录页（LinuxDo 白名单域）。
    await test.service.open(account.id, 'linuxdo');

    expect(test.requests[0]).toMatchObject({
      startUrl: 'https://newapi.example.com/sign-in',
      oauthDomains: ['connect.linux.do'],
      redirectDomains: ['newapi.example.com'],
    });
  });

  it('auto mode without LinuxDo client id falls back to manual browser domains', async () => {
    const test = createService({ account: { ...account, linuxDoClientId: undefined } });

    await test.service.open(account.id, 'auto');

    expect(test.requests[0]).toMatchObject({
      startUrl: 'https://newapi.example.com/login',
      oauthDomains: ['github.com', 'connect.linux.do'],
    });
  });

  it('returns early when LinuxDo headless login succeeds without opening a window', async () => {
    const requests: OpenContainerRequest[] = [];
    const service = new LoginFlowService({
      accountRepository: { get: () => account },
      adapterRegistry: {
        get: () => ({ getPageUrl: () => new URL('https://newapi.example.com/login') }),
      } as never,
      browserContainer: {
        open: request => {
          requests.push(request);
          return {} as never;
        },
      },
      authSessionService: { refreshAuthState: async () => 'active' },
      linuxDoHeadlessLogin: {
        run: async () => ({
          ok: true as const,
          authState: 'active' as const,
          hasSiteUserId: true,
          message: 'LinuxDo 自动登录已完成。',
        }),
      },
    });

    await expect(service.open(account.id, 'auto')).resolves.toMatchObject({
      accountId: account.id,
      mode: 'auto',
      authState: 'active',
      message: 'LinuxDo 自动登录已完成。',
    });
    expect(requests).toHaveLength(0);
  });

  it('falls back to the browser window when headless needs interactive login', async () => {
    const requests: OpenContainerRequest[] = [];
    const service = new LoginFlowService({
      accountRepository: { get: () => account },
      adapterRegistry: {
        get: () => ({ getPageUrl: () => new URL('https://newapi.example.com/login') }),
      } as never,
      browserContainer: {
        open: request => {
          requests.push(request);
          return {} as never;
        },
      },
      authSessionService: { refreshAuthState: async () => 'unknown' },
      linuxDoHeadlessLogin: {
        run: async () => ({
          ok: false as const,
          reason: 'NEEDS_INTERACTIVE' as const,
          fallbackToBrowser: true,
          message: '需要在 LinuxDo 完成登录或确认，将打开手动窗口。',
        }),
      },
    });

    const result = await service.open(account.id, 'auto');
    expect(result).toMatchObject({
      mode: 'auto',
      authState: 'unknown',
    });
    expect(result.message).toContain('需要在 LinuxDo 完成登录或确认');
    expect(requests).toHaveLength(1);
    expect(requests[0]?.startUrl).toBe('https://newapi.example.com/sign-in');
  });

  it('does not open a window when headless rejects an untrusted callback', async () => {
    const requests: OpenContainerRequest[] = [];
    const service = new LoginFlowService({
      accountRepository: { get: () => account },
      adapterRegistry: {
        get: () => ({ getPageUrl: () => new URL('https://newapi.example.com/login') }),
      } as never,
      browserContainer: {
        open: request => {
          requests.push(request);
          return {} as never;
        },
      },
      authSessionService: { refreshAuthState: async () => 'unknown' },
      linuxDoHeadlessLogin: {
        run: async () => ({
          ok: false as const,
          reason: 'CALLBACK_REJECTED' as const,
          fallbackToBrowser: false,
          message: '回调地址不受信，已中止自动登录。',
        }),
      },
    });

    await expect(service.open(account.id, 'auto')).resolves.toMatchObject({
      authState: 'error',
      message: '回调地址不受信，已中止自动登录。',
    });
    expect(requests).toHaveLength(0);
  });

  it('refreshes only the target account session after its login window closes', async () => {
    const test = createService();
    await test.service.open(account.id, 'manual');

    test.closed();
    await Promise.resolve();

    expect(test.refreshes).toEqual([account.id]);
  });

  it('syncs the bound github IdP cookies before opening the login window', async () => {
    const test = createService({
      account: { ...account, authRefId: 'auth-a' },
      identity: { id: 'auth-a', kind: 'github' },
    });

    await test.service.open(account.id, 'manual');

    expect(test.syncCalls).toEqual([{ accountId: account.id, authId: 'auth-a', kind: 'github' }]);
  });

  it('does not sync when the account has no bound auth or the auth is a password identity', async () => {
    const noRef = createService();
    await noRef.service.open(account.id, 'manual');
    expect(noRef.syncCalls).toEqual([]);

    const password = createService({
      account: { ...account, authRefId: 'auth-p' },
      identity: { id: 'auth-p', kind: 'password' },
    });
    await password.service.open(account.id, 'manual');
    expect(password.syncCalls).toEqual([]);
  });

  it('still opens the login window when cookie sync fails', async () => {
    const test = createService({
      account: { ...account, authRefId: 'auth-a' },
      identity: { id: 'auth-a', kind: 'github' },
      syncThrows: true,
    });

    await expect(test.service.open(account.id, 'manual')).resolves.toMatchObject({ accountId: account.id });
    expect(test.requests).toHaveLength(1);
  });

  it('rejects unknown accounts; auto without LinuxDo still opens a browser window', async () => {
    const unknown = createService({ account: null });
    await expect(unknown.service.open(account.id, 'manual')).rejects.toThrow(
      new AppError('ACCOUNT_NOT_FOUND', 'Account was not found.'),
    );

    const missingClientId = createService({ account: { ...account, linuxDoClientId: undefined } });
    await expect(missingClientId.service.open(account.id, 'auto')).resolves.toMatchObject({
      accountId: account.id,
      authState: 'unknown',
    });
    expect(missingClientId.requests).toHaveLength(1);
  });

  it('starts site identity capture for NewAPI manual login and stops it on close', async () => {
    const events: string[] = [];
    const captureHandle = {
      start: () => events.push('start'),
      stop: () => events.push('stop'),
    };
    let onReady: OpenContainerRequest['onWebContentsReady'];
    let onClosed: (() => void) | undefined;

    const service = new LoginFlowService({
      accountRepository: { get: () => account },
      adapterRegistry: {
        get: () => ({ getPageUrl: () => new URL('https://newapi.example.com/login') }),
      } as never,
      browserContainer: {
        open: (async (request: OpenContainerRequest) => {
          onReady = request.onWebContentsReady;
          onClosed = request.onClosed;
          return {} as never;
        }) as never,
      },
      authSessionService: { refreshAuthState: async () => 'active' },
      siteIdentityStore: { getSiteUserId: () => null, upsertSiteIdentity: () => {} },
      createIdentityCapture: (() => captureHandle) as never,
    });

    await service.open(account.id, 'manual');

    // 窗口就绪 → 启动受控提取。
    onReady?.({ getURL: () => '', executeJavaScript: async () => ({}), isDestroyed: () => false } as never);
    expect(events).toContain('start');

    // 关窗 → 停止提取。
    onClosed?.();
    expect(events).toContain('stop');
  });

  it('does not start identity capture for pure headless success path', async () => {
    let started = false;
    const service = new LoginFlowService({
      accountRepository: { get: () => account },
      adapterRegistry: {
        get: () => ({ getPageUrl: () => new URL('https://newapi.example.com/login') }),
      } as never,
      browserContainer: {
        open: async () => {
          throw new Error('should not open');
        },
      },
      authSessionService: { refreshAuthState: async () => 'active' },
      siteIdentityStore: { getSiteUserId: () => null, upsertSiteIdentity: () => {} },
      createIdentityCapture: (() => {
        started = true;
        return { start: () => {}, stop: () => {} };
      }) as never,
      linuxDoHeadlessLogin: {
        run: async () => ({
          ok: true as const,
          authState: 'active' as const,
          hasSiteUserId: true,
          message: 'ok',
        }),
      },
    });

    await service.open(account.id, 'auto');
    expect(started).toBe(false);
  });
});
