import { describe, expect, it } from 'vitest';
import {
  createScriptedSessionClient,
  LinuxDoHeadlessLogin,
} from './linuxdo-headless-login';
import type { SessionResponse } from '../session-request-client';

const account = {
  id: '11111111-1111-4111-8111-111111111111',
  platform: 'newapi' as const,
  baseUrl: 'https://newapi.example.com',
  displayName: 'Account A',
  linuxDoClientId: 'client-id',
};

function json(status: number, body: unknown, headers: Record<string, string> = {}): SessionResponse {
  return {
    status,
    headers,
    bodyText: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

describe('LinuxDoHeadlessLogin', () => {
  it('completes state → authorize → approve → callback and stores site user id', async () => {
    const identities: Record<string, string> = {};
    const { client, urls } = createScriptedSessionClient([
      json(200, { success: true, data: 'IzWzSM88NsI3', message: '' }),
      // authorize manual
      json(
        200,
        '<a href="/oauth2/approve/TOKEN" class="btn-pill btn-pill-primary">允许</a>',
      ),
      // approve manual
      {
        status: 302,
        // 实测 Connect 常回跳 http + SPA 路径 /oauth/linuxdo
        headers: {
          location:
            'http://newapi.example.com/oauth/linuxdo?code=SECRET_CODE&state=IzWzSM88NsI3',
        },
        bodyText: '',
      },
      // 规范化后应请求 https + /api/oauth/linuxdo
      json(200, { success: true, data: { id: 99 } }),
    ]);

    const login = new LinuxDoHeadlessLogin({
      sessionClient: client,
      siteIdentityStore: {
        getSiteUserId: id => identities[id] ?? null,
        upsertSiteIdentity: (id, siteUserId) => {
          identities[id] = siteUserId;
        },
      },
      refreshAuthState: async () => 'active',
    });

    const result = await login.run(account);

    expect(result).toMatchObject({
      ok: true,
      authState: 'active',
      hasSiteUserId: true,
    });
    expect(identities[account.id]).toBe('99');
    expect(urls[0]).toContain('/api/oauth/state');
    expect(urls[1]).toContain('connect.linux.do/oauth2/authorize');
    expect(urls[2]).toContain('/oauth2/approve/TOKEN');
    expect(urls[3]).toContain('https://newapi.example.com/api/oauth/linuxdo');
    expect(urls[3]).toContain('code=SECRET_CODE');
    expect(urls[3]).not.toContain('http://newapi.example.com/oauth/linuxdo');
  });

  it('falls back to follow when authorize manual throws (Chromium opaque redirect)', async () => {
    const { client, urls } = createScriptedSessionClient([
      json(200, { success: true, data: 'state-1', message: '' }),
      // authorize manual throws
      new Error('Failed to fetch'),
      // authorize follow returns HTML
      json(
        200,
        '<a href="/oauth2/approve/TOKEN" class="btn-pill btn-pill-primary">允许</a>',
        {},
      ),
      // approve manual
      {
        status: 302,
        headers: {
          location: 'https://newapi.example.com/api/oauth/linuxdo?code=x&state=state-1',
        },
        bodyText: '',
      },
      json(200, { success: true, data: { id: 1 } }),
    ]);

    const identities: Record<string, string> = {};
    const login = new LinuxDoHeadlessLogin({
      sessionClient: client,
      siteIdentityStore: {
        getSiteUserId: id => identities[id] ?? null,
        upsertSiteIdentity: (id, uid) => {
          identities[id] = uid;
        },
      },
      refreshAuthState: async () => 'active',
    });

    await expect(login.run(account)).resolves.toMatchObject({ ok: true, authState: 'active' });
    // state + authorize manual(throw counts as request) + authorize follow + approve + callback
    expect(urls.length).toBeGreaterThanOrEqual(4);
    expect(urls.filter(u => u.includes('/oauth2/authorize')).length).toBe(2);
  });

  it('falls back when authorize page has no approve link', async () => {
    const { client } = createScriptedSessionClient([
      json(200, { success: true, data: 'state-1', message: '' }),
      json(200, '<html><body>请登录 LinuxDo</body></html>'),
      // follow also interactive
      json(200, '<html><body>请登录 LinuxDo</body></html>'),
    ]);

    const login = new LinuxDoHeadlessLogin({
      sessionClient: client,
      refreshAuthState: async () => 'unknown',
    });

    await expect(login.run(account)).resolves.toMatchObject({
      ok: false,
      reason: 'NEEDS_INTERACTIVE',
      fallbackToBrowser: true,
    });
  });

  it('rewrites SPA callback path and still rejects host mismatch after normalize', async () => {
    // normalize 会把 host 改成账户站点 host；evil 不会被请求。
    const { client, urls } = createScriptedSessionClient([
      json(200, { success: true, data: 'state-1', message: '' }),
      json(
        200,
        '<a href="/oauth2/approve/TOKEN" class="btn-pill btn-pill-primary">允许</a>',
      ),
      {
        status: 302,
        headers: {
          location: 'https://evil.example/oauth/linuxdo?code=x&state=state-1',
        },
        bodyText: '',
      },
      // 规范化后变成 newapi.example.com/api/oauth/linuxdo
      json(200, { success: true, data: { id: 3 } }),
    ]);

    const identities: Record<string, string> = {};
    const login = new LinuxDoHeadlessLogin({
      sessionClient: client,
      siteIdentityStore: {
        getSiteUserId: id => identities[id] ?? null,
        upsertSiteIdentity: (id, uid) => {
          identities[id] = uid;
        },
      },
      refreshAuthState: async () => 'active',
    });

    await expect(login.run(account)).resolves.toMatchObject({ ok: true });
    expect(urls.filter(u => u.includes('evil.example'))).toHaveLength(0);
    expect(urls.some(u => u.includes('https://newapi.example.com/api/oauth/linuxdo'))).toBe(true);
  });

  it('falls back when state API fails', async () => {
    const { client } = createScriptedSessionClient([
      json(200, { success: false, data: '', message: 'no' }),
    ]);

    const login = new LinuxDoHeadlessLogin({
      sessionClient: client,
      refreshAuthState: async () => 'unknown',
    });

    await expect(login.run(account)).resolves.toMatchObject({
      ok: false,
      reason: 'STATE_FAILED',
      fallbackToBrowser: true,
    });
  });

  it('treats authorize redirect to password login as interactive', async () => {
    const { client } = createScriptedSessionClient([
      json(200, { success: true, data: 'state-1', message: '' }),
      // follow ends at password login
      {
        status: 200,
        headers: {},
        bodyText: '<html>login</html>',
        finalUrl: 'https://linux.do/login',
      },
      // manual first hop also login
      {
        status: 302,
        headers: { location: 'https://linux.do/login' },
        bodyText: '',
      },
    ]);

    const login = new LinuxDoHeadlessLogin({
      sessionClient: client,
      refreshAuthState: async () => 'unknown',
    });

    await expect(login.run(account)).resolves.toMatchObject({
      ok: false,
      reason: 'NEEDS_INTERACTIVE',
      fallbackToBrowser: true,
    });
  });

  it('follows Discourse SSO bridge then parses authorize HTML', async () => {
    const identities: Record<string, string> = {};
    const { client, urls } = createScriptedSessionClient([
      json(200, { success: true, data: 'state-1', message: '' }),
      // follow: after SSO bridge, land on authorize HTML with approve
      json(
        200,
        '<a href="/oauth2/approve/TOKEN" class="btn-pill btn-pill-primary">允许</a>',
      ),
      {
        status: 302,
        headers: {
          location: 'https://newapi.example.com/api/oauth/linuxdo?code=c&state=state-1',
        },
        bodyText: '',
      },
      json(200, { success: true, data: { id: 5 } }),
    ]);

    const login = new LinuxDoHeadlessLogin({
      sessionClient: client,
      siteIdentityStore: {
        getSiteUserId: id => identities[id] ?? null,
        upsertSiteIdentity: (id, uid) => {
          identities[id] = uid;
        },
      },
      refreshAuthState: async () => 'active',
    });

    await expect(login.run(account)).resolves.toMatchObject({ ok: true, authState: 'active' });
    expect(urls[1]).toContain('/oauth2/authorize');
  });
});
