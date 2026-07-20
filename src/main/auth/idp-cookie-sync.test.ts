import { describe, expect, it } from 'vitest';
import { IdpCookieSyncService } from './idp-cookie-sync';
import type { CookieLike, CookiesSetDetailsLike, ElectronSessionLike } from './session-service';

function makeSession(cookies: CookieLike[] = []) {
  const sets: CookiesSetDetailsLike[] = [];
  const session: ElectronSessionLike = {
    clearStorageData: async () => {},
    clearCache: async () => {},
    cookies: {
      get: async () => cookies,
      set: async details => {
        sets.push(details);
      },
    },
    setProxy: async () => {},
    closeAllConnections: async () => {},
  };
  return { session, sets };
}

describe('IdpCookieSyncService', () => {
  it('copies only github cookies into the account session', async () => {
    const auth = makeSession([
      {
        name: 'user_session',
        value: 'secret-a',
        domain: '.github.com',
        path: '/',
        secure: true,
        httpOnly: true,
        expirationDate: 4_000_000_000,
        sameSite: 'lax',
      },
      {
        name: 'site_session',
        value: 'must-not-copy',
        domain: 'newapi.example.com',
        path: '/',
        secure: true,
      },
      {
        name: 'linuxdo_session',
        value: 'wrong-kind',
        domain: 'connect.linux.do',
        path: '/',
        secure: true,
      },
    ]);
    const account = makeSession();
    const service = new IdpCookieSyncService({
      partitionManager: {
        getAuthSession: () => auth.session,
        getAccountSession: () => account.session,
      },
      nowSeconds: () => 1_700_000_000,
    });

    const result = await service.syncLinkedIdpCookies({
      accountId: 'account-a',
      authId: 'auth-a',
      kind: 'github',
    });

    expect(result.copied).toBe(1);
    expect(account.sets).toHaveLength(1);
    expect(account.sets[0]).toMatchObject({
      name: 'user_session',
      domain: '.github.com',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
    });
    expect(account.sets[0].url).toContain('github.com');
    expect(JSON.stringify(result)).not.toContain('secret-a');
  });

  it('skips expired cookies and copies linuxdo allowlisted hosts', async () => {
    const auth = makeSession([
      {
        name: 'expired',
        value: 'old',
        domain: 'connect.linux.do',
        path: '/',
        expirationDate: 1_000,
      },
      {
        name: 'fresh',
        value: 'ok',
        domain: 'linux.do',
        path: '/',
        secure: true,
        expirationDate: 4_000_000_000,
      },
    ]);
    const account = makeSession();
    const service = new IdpCookieSyncService({
      partitionManager: {
        getAuthSession: () => auth.session,
        getAccountSession: () => account.session,
      },
      nowSeconds: () => 2_000,
    });

    const result = await service.syncLinkedIdpCookies({
      accountId: 'account-a',
      authId: 'auth-b',
      kind: 'linuxdo',
    });

    expect(result.copied).toBe(1);
    expect(account.sets[0]?.name).toBe('fresh');
  });

  it('returns zero when the auth session has no matching cookies', async () => {
    const auth = makeSession([]);
    const account = makeSession();
    const service = new IdpCookieSyncService({
      partitionManager: {
        getAuthSession: () => auth.session,
        getAccountSession: () => account.session,
      },
    });

    await expect(
      service.syncLinkedIdpCookies({
        accountId: 'account-a',
        authId: 'auth-a',
        kind: 'github',
      }),
    ).resolves.toEqual({ copied: 0 });
    expect(account.sets).toHaveLength(0);
  });
});
