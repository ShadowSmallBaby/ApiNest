import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/shared/ipc/errors';
import { redactSensitiveData } from '../src/main/logging/logger';
import { buildIpcHandlers } from '../src/main/ipc/handlers';
import { decideNavigation, decidePermission, decideWindowOpen, isDownloadAllowed } from '../src/main/browser/navigation-policy';

const accountId = '11111111-1111-4111-8111-111111111111';

describe('OAuth、导航与异常负向场景', () => {
  it('拒绝未知 OAuth 回跳、window.open、权限和下载', () => {
    const context = {
      baseUrl: 'https://newapi.example.com',
      oauthDomains: ['connect.linux.do'],
      redirectDomains: ['newapi.example.com'],
    };

    expect(decideNavigation('https://evil.example/callback', context).allowed).toBe(false);
    // 策略外域名的 window.open 一律拒绝；策略内域名（站点/OAuth）则由容器改为同窗导航处理。
    expect(decideWindowOpen('https://evil.example/popup', context).allowed).toBe(false);
    expect(decideWindowOpen('https://connect.linux.do/oauth2/authorize', context).allowed).toBe(true);
    expect(decidePermission('clipboard-read').allowed).toBe(false);
    expect(isDownloadAllowed()).toBe(false);
  });

  it('锁定时敏感 IPC 不会触发登录、签到或页面打开', async () => {
    const assertUnlocked = vi.fn(() => {
      throw new AppError('LOCKED', 'Application is locked. Unlock it before using sensitive capabilities.');
    });
    const handlers = buildIpcHandlers({
      lockService: {
        isInitialized: () => true,
        isUnlocked: () => false,
        initialize: async () => {},
        unlock: async () => {},
        lock: () => {},
        assertUnlocked,
      },
      loginFlowService: { open: () => { throw new Error('must not run'); } },
      checkInService: { run: async () => { throw new Error('must not run'); } },
      inAppPageOpener: () => { throw new Error('must not run'); },
    });

    await expect(handlers['auth:open-login']({ accountId, mode: 'manual' })).rejects.toMatchObject({ code: 'LOCKED' });
    await expect(handlers['checkin:run-one']({ accountId })).rejects.toMatchObject({ code: 'LOCKED' });
    await expect(handlers['pages:open-in-app']({ accountId, page: 'login' })).rejects.toMatchObject({ code: 'LOCKED' });
    expect(assertUnlocked).toHaveBeenCalledTimes(3);
  });

  it('脱敏日志投影不保留 Cookie、token、OAuth code 或 Authorization', () => {
    const value = redactSensitiveData({
      Cookie: 'session=secret-cookie',
      Authorization: 'Bearer secret-token',
      query: 'https://example.com/callback?code=oauth-code&access_token=secret',
    });
    const serialized = JSON.stringify(value);

    expect(serialized).not.toContain('secret-cookie');
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('oauth-code');
  });
});
