import { getAccountPartition } from '../../auth/account-partition';
import type { SessionRequestClient, SessionRequestOptions, SessionResponse } from '../session-request-client';
import { NewApiAdapter } from './newapi-adapter';

const account = {
  id: '11111111-1111-4111-8111-111111111111',
  platform: 'newapi' as const,
  baseUrl: 'https://example.com',
  displayName: 'Account A',
};

const SITE_USER_ID = '42';

const routeProfiles = ['modern', 'classic', 'legacy-panel'] as const;

describe('NewApiAdapter checkIn', () => {
  function createClient(response: SessionResponse): {
    client: SessionRequestClient;
    calls: Array<{ url: string; options: SessionRequestOptions }>;
  } {
    const calls: Array<{ url: string; options: SessionRequestOptions }> = [];
    return {
      client: {
        fetchWithSession: async (url, options) => {
          calls.push({ url, options });
          return response;
        },
      },
      calls,
    };
  }

  it('posts the one confirmed endpoint through the account partition with the New-Api-User header', async () => {
    const { client, calls } = createClient({ status: 200, headers: {}, bodyText: '{"success":true}' });
    const adapter = new NewApiAdapter({ sessionClient: client });

    await expect(adapter.checkIn({
      accountId: account.id,
      baseUrl: account.baseUrl,
      platform: account.platform,
      partition: getAccountPartition(account.id),
      siteUserId: SITE_USER_ID,
    })).resolves.toMatchObject({ accountId: account.id, result: 'success' });

    expect(calls).toEqual([{
      url: 'https://example.com/api/user/checkin',
      options: {
        partition: getAccountPartition(account.id),
        method: 'POST',
        headers: { 'New-Api-User': SITE_USER_ID },
      },
    }]);
  });

  it.each(routeProfiles)('uses the shared API endpoint for the %s route profile', async routeProfile => {
    const { client, calls } = createClient({ status: 200, headers: {}, bodyText: '{"success":true}' });
    const adapter = new NewApiAdapter({ sessionClient: client });

    expect(adapter.getPageUrl({ ...account, routeProfile }, 'token')).toBeTruthy();

    await adapter.checkIn({
      accountId: account.id,
      baseUrl: account.baseUrl,
      platform: account.platform,
      partition: getAccountPartition(account.id),
      siteUserId: SITE_USER_ID,
    });

    expect(calls).toEqual([{
      url: 'https://example.com/api/user/checkin',
      options: {
        partition: getAccountPartition(account.id),
        method: 'POST',
        headers: { 'New-Api-User': SITE_USER_ID },
      },
    }]);
  });

  it('does not report a request failure as a successful check-in', async () => {
    const { client } = createClient({ status: 500, headers: {}, bodyText: '{"success":true}' });
    const adapter = new NewApiAdapter({ sessionClient: client });

    await expect(adapter.checkIn({
      accountId: account.id,
      baseUrl: account.baseUrl,
      platform: account.platform,
      partition: getAccountPartition(account.id),
      siteUserId: SITE_USER_ID,
    })).resolves.toMatchObject({ result: 'failed' });
  });

  it('returns session_expired without any request when the site user id is missing', async () => {
    const { client, calls } = createClient({ status: 200, headers: {}, bodyText: '{"success":true}' });
    const adapter = new NewApiAdapter({ sessionClient: client });

    await expect(adapter.checkIn({
      accountId: account.id,
      baseUrl: account.baseUrl,
      platform: account.platform,
      partition: getAccountPartition(account.id),
    })).resolves.toMatchObject({ result: 'session_expired' });
    expect(calls).toEqual([]);
  });

  it('maps a Cloudflare challenge response to challenge_required instead of session_expired', async () => {
    const { client } = createClient({
      status: 403,
      headers: { 'cf-mitigated': 'challenge', server: 'cloudflare' },
      bodyText: '<html>Just a moment...</html>',
    });
    const adapter = new NewApiAdapter({ sessionClient: client });

    await expect(adapter.checkIn({
      accountId: account.id,
      baseUrl: account.baseUrl,
      platform: account.platform,
      partition: getAccountPartition(account.id),
      siteUserId: SITE_USER_ID,
    })).resolves.toMatchObject({ result: 'challenge_required' });
  });
});
