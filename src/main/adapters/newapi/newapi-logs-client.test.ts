import { getAccountPartition } from '../../auth/account-partition';
import type { SessionRequestClient, SessionResponse } from '../session-request-client';
import { NewApiLogsClient } from './newapi-logs-client';

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
const SITE_USER_ID = '42';

function response(body: unknown): SessionResponse {
  return { status: 200, headers: {}, bodyText: JSON.stringify(body) };
}

describe('NewApiLogsClient', () => {
  it('builds a bounded query, uses the account partition, and sends the New-Api-User header', async () => {
    let capturedUrl = '';
    let capturedOptions: Parameters<SessionRequestClient['fetchWithSession']>[1] | undefined;
    const sessionClient: SessionRequestClient = {
      fetchWithSession: async (url, options) => {
        capturedUrl = url;
        capturedOptions = options;
        return response({ success: true, data: { items: [], total: 0 } });
      },
    };
    const client = new NewApiLogsClient({ sessionClient });

    const result = await client.listByAccount({
      accountId: ACCOUNT_ID,
      baseUrl: 'https://demo.example.com/panel',
      siteUserId: SITE_USER_ID,
      query: {
        page: 2,
        pageSize: 50,
        type: 2,
        tokenName: 'production key',
        modelName: 'gpt-4o',
        startTimestamp: 100,
        endTimestamp: 200,
      },
    });

    const url = new URL(capturedUrl);
    expect(url.pathname).toBe('/api/log/self');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      p: '2',
      page_size: '50',
      type: '2',
      token_name: 'production key',
      model_name: 'gpt-4o',
      start_timestamp: '100',
      end_timestamp: '200',
    });
    expect(capturedOptions).toEqual({
      partition: getAccountPartition(ACCOUNT_ID),
      headers: { 'New-Api-User': SITE_USER_ID },
      bodyLimit: 2 * 1024 * 1024,
    });
    expect(result.total).toBe(0);
  });

  it('omits optional filters that were not supplied', async () => {
    let capturedUrl = '';
    const client = new NewApiLogsClient({
      sessionClient: {
        fetchWithSession: async url => {
          capturedUrl = url;
          return response({ items: [], total: 0 });
        },
      },
    });

    await client.listByAccount({
      accountId: ACCOUNT_ID,
      baseUrl: 'https://demo.example.com',
      siteUserId: SITE_USER_ID,
      query: { page: 1, pageSize: 100 },
    });

    expect(Object.fromEntries(new URL(capturedUrl).searchParams)).toEqual({ p: '1', page_size: '100' });
  });

  it('throws UPSTREAM_INVALID_RESPONSE when the body cannot be parsed instead of returning an empty page', async () => {
    const client = new NewApiLogsClient({
      sessionClient: {
        fetchWithSession: async () => ({ status: 200, headers: {}, bodyText: '<html>login</html>' }),
      },
    });

    await expect(client.listByAccount({
      accountId: ACCOUNT_ID,
      baseUrl: 'https://demo.example.com',
      siteUserId: SITE_USER_ID,
      query: { page: 1, pageSize: 50 },
    })).rejects.toMatchObject({ code: 'UPSTREAM_INVALID_RESPONSE' });
  });

  it('maps a 401 response to SESSION_EXPIRED before parsing', async () => {
    const client = new NewApiLogsClient({
      sessionClient: {
        fetchWithSession: async () => ({ status: 401, headers: {}, bodyText: '{"success":false}' }),
      },
    });

    await expect(client.listByAccount({
      accountId: ACCOUNT_ID,
      baseUrl: 'https://demo.example.com',
      siteUserId: SITE_USER_ID,
      query: { page: 1, pageSize: 50 },
    })).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });

  it('keeps partitions isolated for two accounts on the same base URL', async () => {
    const partitions: string[] = [];
    const client = new NewApiLogsClient({
      sessionClient: {
        fetchWithSession: async (_url, options) => {
          partitions.push(options.partition);
          return response({ items: [], total: 0 });
        },
      },
    });
    const otherAccountId = '00000000-0000-4000-8000-000000000002';

    await client.listByAccount({ accountId: ACCOUNT_ID, baseUrl: 'https://same.example.com', siteUserId: SITE_USER_ID, query: { page: 1, pageSize: 50 } });
    await client.listByAccount({ accountId: otherAccountId, baseUrl: 'https://same.example.com', siteUserId: '99', query: { page: 1, pageSize: 50 } });

    expect(partitions).toEqual([getAccountPartition(ACCOUNT_ID), getAccountPartition(otherAccountId)]);
    expect(partitions[0]).not.toBe(partitions[1]);
  });
});
