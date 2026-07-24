import { AppError } from '../../shared/ipc/errors';
import type { LockService } from '../security/lock-service';
import { buildIpcHandlers } from './handlers';

type TestLockService = Pick<
  LockService,
  'isInitialized' | 'isUnlocked' | 'initialize' | 'unlock' | 'lock' | 'assertUnlocked'
>;

function createTestLockService(): TestLockService {
  let initialized = false;
  let unlocked = false;

  return {
    isInitialized: () => initialized,
    isUnlocked: () => unlocked,
    initialize: async () => {
      initialized = true;
      unlocked = true;
    },
    unlock: async (masterPassword: string) => {
      if (masterPassword !== 'correct horse battery staple') {
        throw new AppError('UNAUTHORIZED', 'Invalid master password.');
      }

      unlocked = true;
    },
    lock: () => {
      unlocked = false;
    },
    assertUnlocked: () => {
      if (!unlocked) {
        throw new AppError('LOCKED', 'Application is locked. Unlock it before using sensitive capabilities.');
      }
    },
  };
}

describe('buildIpcHandlers', () => {
  async function createSiteAccount(
    handlers: ReturnType<typeof buildIpcHandlers>,
    platform: 'newapi' | 'sub2api' | 'cliproxyapi',
    baseUrl: string,
    displayName: string,
  ): Promise<{ id: string }> {
    const result = await handlers['sites:create']({
      name: `${displayName} Site`,
      platform,
      baseUrl,
      routeProfile: 'modern',
      firstAccount: { displayName },
    }) as { account: { id: string } };
    return result.account;
  }

  it('rejects invalid account ids for refresh', async () => {
    const handlers = buildIpcHandlers();

    await expect(handlers['accounts:refresh']('bad-id')).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });
  });

  it('rejects invalid create payloads', async () => {
    const handlers = buildIpcHandlers();

    await expect(handlers['accounts:create']({ platform: 'newapi' })).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });
  });

  it('rejects platform detection while locked', async () => {
    const lockService = createTestLockService();
    const handlers = buildIpcHandlers({ lockService });

    await expect(
      handlers['sites:detect-platform']({ baseUrl: 'https://example.com' }),
    ).rejects.toMatchObject({ code: 'LOCKED' });
  });

  it('rejects platform detection with an invalid base url', async () => {
    const lockService = createTestLockService();
    const handlers = buildIpcHandlers({ lockService });
    await handlers['auth:unlock']({ masterPassword: 'correct horse battery staple' });

    await expect(
      handlers['sites:detect-platform']({ baseUrl: 'not-a-url' }),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('delegates platform detection to SiteService after validating the payload', async () => {
    const lockService = createTestLockService();
    const detectedBaseUrls: string[] = [];
    const handlers = buildIpcHandlers({
      lockService,
      siteService: {
        list: () => [],
        get: () => { throw new Error('Unexpected site lookup.'); },
        create: () => { throw new Error('Unexpected site creation.'); },
        update: () => { throw new Error('Unexpected site update.'); },
        detectPlatform: async baseUrl => {
          detectedBaseUrls.push(baseUrl);
          return { platform: 'newapi', confidence: 'high', reason: 'Delegated detection.' };
        },
        addAccount: () => { throw new Error('Unexpected account creation.'); },
        remove: async () => { throw new Error('Unexpected site removal.'); },
        getSummaries: () => { throw new Error('Unexpected site summaries.'); },
      },
    });
    await handlers['auth:unlock']({ masterPassword: 'correct horse battery staple' });

    await expect(
      handlers['sites:detect-platform']({ baseUrl: 'https://example.com' }),
    ).resolves.toEqual({ platform: 'newapi', confidence: 'high', reason: 'Delegated detection.' });
    expect(detectedBaseUrls).toEqual(['https://example.com']);
  });

  it('returns an unknown detection result without a probe client', async () => {
    const lockService = createTestLockService();
    const handlers = buildIpcHandlers({ lockService });
    await handlers['auth:unlock']({ masterPassword: 'correct horse battery staple' });

    await expect(
      handlers['sites:detect-platform']({ baseUrl: 'https://example.com' }),
    ).resolves.toMatchObject({ platform: 'newapi', confidence: 'unknown' });
  });

  it('initializes on first unlock and exposes auth status', async () => {
    const lockService = createTestLockService();
    const handlers = buildIpcHandlers({ lockService });

    await expect(handlers['auth:status']({})).resolves.toEqual({
      initialized: false,
      unlocked: false,
    });

    await expect(
      handlers['auth:unlock']({ masterPassword: 'correct horse battery staple' }),
    ).resolves.toBeUndefined();

    await expect(handlers['auth:status']({})).resolves.toEqual({
      initialized: true,
      unlocked: true,
    });
  });

  it('locks and rejects sensitive handlers while locked', async () => {
    const lockService = createTestLockService();
    const handlers = buildIpcHandlers({ lockService });

    await handlers['auth:unlock']({ masterPassword: 'correct horse battery staple' });
    await handlers['auth:lock']({});

    await expect(handlers['accounts:list']()).resolves.toEqual([]);
    await expect(handlers['accounts:refresh']('11111111-1111-4111-8111-111111111111')).rejects.toMatchObject({
      code: 'LOCKED',
    });
    await expect(
      handlers['checkin:run-one']({ accountId: '11111111-1111-4111-8111-111111111111' }),
    ).rejects.toMatchObject({
      code: 'LOCKED',
    });
    await expect(
      handlers['pages:open-in-app']({ accountId: '11111111-1111-4111-8111-111111111111', page: 'home' }),
    ).rejects.toMatchObject({
      code: 'LOCKED',
    });
  });

  it('unlocks initialized vaults with the correct password only', async () => {
    const lockService = createTestLockService();
    const handlers = buildIpcHandlers({ lockService });

    await handlers['auth:unlock']({ masterPassword: 'correct horse battery staple' });
    await handlers['auth:lock']({});

    await expect(handlers['auth:unlock']({ masterPassword: 'wrong password' })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    await expect(
      handlers['auth:unlock']({ masterPassword: 'correct horse battery staple' }),
    ).resolves.toBeUndefined();
  });

  it('delegates refresh to the injected refresh service when unlocked', async () => {
    const accountId = '11111111-1111-4111-8111-111111111111';
    const lockService = createTestLockService();
    const refreshService = {
      refresh: async (id: string) => ({
        accountId: id,
        authState: 'unknown' as const,
        message: 'Refresh completed.',
      }),
    };
    const handlers = buildIpcHandlers({ lockService, refreshService });
    await handlers['auth:unlock']({ masterPassword: 'correct horse battery staple' });

    await expect(handlers['accounts:refresh'](accountId)).resolves.toEqual({
      accountId,
      authState: 'unknown',
      message: 'Refresh completed.',
    });
  });

  it('rejects refresh while locked', async () => {
    const lockService = createTestLockService();
    const refreshService = {
      refresh: async () => {
        throw new Error('should not be called while locked');
      },
    };
    const handlers = buildIpcHandlers({ lockService, refreshService });

    await expect(
      handlers['accounts:refresh']('11111111-1111-4111-8111-111111111111'),
    ).rejects.toMatchObject({ code: 'LOCKED' });
  });

  it('delegates manual and LinuxDo login only while unlocked', async () => {
    const accountId = '11111111-1111-4111-8111-111111111111';
    const lockService = createTestLockService();
    const calls: Array<{ accountId: string; mode: string }> = [];
    const handlers = buildIpcHandlers({
      lockService,
      loginFlowService: {
        open: async (id, mode = 'auto') => {
          calls.push({ accountId: id, mode });
          return {
            accountId: id,
            mode,
            authState: 'unknown',
            message: 'Login window opened.',
          };
        },
      },
    });

    await expect(
      handlers['auth:open-login']({ accountId, mode: 'manual' }),
    ).rejects.toMatchObject({ code: 'LOCKED' });

    await handlers['auth:unlock']({ masterPassword: 'correct horse battery staple' });
    await expect(
      handlers['auth:open-login']({ accountId, mode: 'linuxdo' }),
    ).resolves.toMatchObject({ accountId, mode: 'linuxdo' });
    expect(calls).toEqual([{ accountId, mode: 'linuxdo' }]);
  });

  it('delegates an unlocked check-in to the injected service', async () => {
    const accountId = '11111111-1111-4111-8111-111111111111';
    const lockService = createTestLockService();
    const checkInService = {
      run: async (id: string) => ({
        accountId: id,
        result: 'success' as const,
        message: 'Check-in completed.',
      }),
    };
    const handlers = buildIpcHandlers({ lockService, checkInService });
    await handlers['auth:unlock']({ masterPassword: 'correct horse battery staple' });

    await expect(
      handlers['checkin:run-one']({ accountId }),
    ).resolves.toEqual({
      accountId,
      result: 'success',
      message: 'Check-in completed.',
    });
  });

  it('rejects check-in while locked before invoking its service', async () => {
    const lockService = createTestLockService();
    const handlers = buildIpcHandlers({
      lockService,
      checkInService: {
        run: async () => {
          throw new Error('should not be called while locked');
        },
      },
    });

    await expect(
      handlers['checkin:run-one']({ accountId: '11111111-1111-4111-8111-111111111111' }),
    ).rejects.toMatchObject({ code: 'LOCKED' });
  });

  it('rejects check-in if the composition root has not wired its service', async () => {
    const handlers = buildIpcHandlers();

    await expect(
      handlers['checkin:run-one']({ accountId: '11111111-1111-4111-8111-111111111111' }),
    ).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
  });

  it('runs a snapshot of only check-in-capable accounts in batch', async () => {
    const lockService = createTestLockService();
    const received: string[][] = [];
    const handlers = buildIpcHandlers({
      lockService,
      batchCheckInOrchestrator: {
        run: async ids => {
          received.push(ids);
          return { total: ids.length, results: [] };
        },
      },
    });
    await handlers['auth:unlock']({ masterPassword: 'correct horse battery staple' });
    const supported = await createSiteAccount(handlers, 'newapi', 'https://newapi.example.com', 'Supported');
    await createSiteAccount(handlers, 'sub2api', 'https://sub2api.example.com', 'Unsupported');

    await expect(handlers['checkin:run-all']({})).resolves.toEqual({ total: 1, results: [] });
    expect(received).toEqual([[supported.id]]);
  });

  it('plaza batchLogin only targets autoLogin eligible accounts and is locked-gated', async () => {
    const lockService = createTestLockService();
    const authId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const received: string[][] = [];
    const handlers = buildIpcHandlers({
      lockService,
      batchLoginOrchestrator: {
        run: async ids => {
          received.push(ids);
          return {
            total: ids.length,
            results: ids.map(accountId => ({
              accountId,
              authState: 'active' as const,
              message: 'ok',
            })),
          };
        },
      },
      authIdentityRepository: {
        get: id =>
          id === authId
            ? {
                id: authId,
                kind: 'github' as const,
                label: 'GH',
                hasCredential: false,
                useProxy: false,
                createdAt: '',
              }
            : null,
      },
      siteOAuthConfigRepo: {
        list: () => [
          {
            id: 'cfg',
            siteId: 'ignored',
            oauthProvider: 'github' as const,
            clientId: 'client',
            createdAt: '',
            updatedAt: '',
          },
        ],
      } as never,
    });

    await expect(handlers['sites:batch-login']({})).rejects.toMatchObject({ code: 'LOCKED' });
    await handlers['auth:unlock']({ masterPassword: 'correct horse battery staple' });

    // 默认创建的站点 autoLogin=false → 无 eligible
    await createSiteAccount(handlers, 'newapi', 'https://plain.example.com', 'Plain');
    await expect(handlers['sites:batch-login']({})).resolves.toEqual({ total: 0, results: [] });
    expect(received).toEqual([[]]);

    // 开启 autoLogin 并绑定匹配 OAuth 身份
    const created = await handlers['sites:create']({
      name: 'Auto',
      platform: 'newapi',
      baseUrl: 'https://auto.example.com',
      routeProfile: 'modern',
      autoLogin: true,
      firstAccount: { displayName: 'AutoAcc', authId },
    }) as { site: { id: string }; account: { id: string } };

    await handlers['accounts:link-auth']({ accountId: created.account.id, authId });
    // 内存 account 默认 authState=unknown，满足「非 active」
    received.length = 0;
    await expect(handlers['sites:batch-login']({})).resolves.toMatchObject({ total: 1 });
    expect(received[0]).toEqual([created.account.id]);
  });

  it('plaza batchCheckIn only targets autoCheckIn active accounts not checked-in today', async () => {
    const lockService = createTestLockService();
    const received: string[][] = [];
    const handlers = buildIpcHandlers({
      lockService,
      batchCheckInOrchestrator: {
        run: async ids => {
          received.push(ids);
          return { total: ids.length, results: [] };
        },
      },
      checkInResultRepository: {
        listCheckedInAccountIdsToday: () => new Set<string>(),
      },
    });
    await handlers['auth:unlock']({ masterPassword: 'correct horse battery staple' });

    // 无 autoCheckIn 时不入选
    await createSiteAccount(handlers, 'newapi', 'https://nocheck.example.com', 'NoAuto');
    await expect(handlers['sites:batch-checkin']({})).resolves.toEqual({ total: 0, results: [] });

    // 开启 autoCheckIn；内存账户 authState=unknown，仍不入选（需 active）
    await handlers['sites:create']({
      name: 'Check',
      platform: 'newapi',
      baseUrl: 'https://check.example.com',
      routeProfile: 'modern',
      autoCheckIn: true,
      firstAccount: { displayName: 'Chk' },
    });
    await expect(handlers['sites:batch-checkin']({})).resolves.toEqual({ total: 0, results: [] });
    // 收到的两次调用都是空数组
    expect(received.every(ids => ids.length === 0)).toBe(true);
  });

  it('rejects batch check-in while locked before creating an account snapshot', async () => {
    const lockService = createTestLockService();
    const handlers = buildIpcHandlers({
      lockService,
      batchCheckInOrchestrator: {
        run: async () => {
          throw new Error('should not run while locked');
        },
      },
    });

    await expect(handlers['checkin:run-all']({})).rejects.toMatchObject({ code: 'LOCKED' });
  });

  it('opens a known page in app with the account id, base url and resolved url', async () => {
    const lockService = createTestLockService();
    const opened: Array<{ accountId: string; baseUrl: string; url: string }> = [];
    const handlers = buildIpcHandlers({
      lockService,
      inAppPageOpener: request => {
        opened.push(request);
      },
    });
    await handlers['auth:unlock']({ masterPassword: 'correct horse battery staple' });

    const account = await createSiteAccount(handlers, 'newapi', 'https://newapi.example.com', 'Account A');

    await handlers['pages:open-in-app']({ accountId: account.id, page: 'login' });

    expect(opened).toEqual([
      {
        accountId: account.id,
        baseUrl: 'https://newapi.example.com',
        url: 'https://newapi.example.com/sign-in',
      },
    ]);
  });

  it('rejects opening a page in app for an unknown account', async () => {
    const lockService = createTestLockService();
    const handlers = buildIpcHandlers({
      lockService,
      inAppPageOpener: () => {
        throw new Error('should not be called for an unknown account');
      },
    });
    await handlers['auth:unlock']({ masterPassword: 'correct horse battery staple' });

    await expect(
      handlers['pages:open-in-app']({
        accountId: '11111111-1111-4111-8111-111111111111',
        page: 'home',
      }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
  });

  it('rejects opening a page for an unsupported platform without any url', async () => {
    const lockService = createTestLockService();
    const opened: unknown[] = [];
    const handlers = buildIpcHandlers({
      lockService,
      inAppPageOpener: request => {
        opened.push(request);
      },
    });
    await handlers['auth:unlock']({ masterPassword: 'correct horse battery staple' });

    const account = await createSiteAccount(handlers, 'sub2api', 'https://sub2api.example.com', 'Unsupported');

    await expect(
      handlers['pages:open-in-app']({ accountId: account.id, page: 'home' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(opened).toEqual([]);
  });

  it('reports not implemented when no in-app opener is wired', async () => {
    const lockService = createTestLockService();
    const handlers = buildIpcHandlers({ lockService });
    await handlers['auth:unlock']({ masterPassword: 'correct horse battery staple' });

    const account = await createSiteAccount(handlers, 'newapi', 'https://newapi.example.com', 'Account A');

    await expect(
      handlers['pages:open-in-app']({ accountId: account.id, page: 'home' }),
    ).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
  });

  it('rejects opening an external page for an unknown account before touching the shell', async () => {
    const lockService = createTestLockService();
    const handlers = buildIpcHandlers({ lockService });
    await handlers['auth:unlock']({ masterPassword: 'correct horse battery staple' });

    await expect(
      handlers['pages:open-external']({
        accountId: '11111111-1111-4111-8111-111111111111',
        page: 'home',
      }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
  });

  it('rejects opening pages while locked before resolving any url', async () => {
    const lockService = createTestLockService();
    const handlers = buildIpcHandlers({
      lockService,
      inAppPageOpener: () => {
        throw new Error('should not be called while locked');
      },
    });

    await expect(
      handlers['pages:open-external']({
        accountId: '11111111-1111-4111-8111-111111111111',
        page: 'home',
      }),
    ).rejects.toMatchObject({ code: 'LOCKED' });
  });
});
