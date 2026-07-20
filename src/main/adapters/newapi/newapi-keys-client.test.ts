import { getAccountPartition } from '../../auth/account-partition';
import type { SessionRequestClient, SessionRequestOptions, SessionResponse } from '../session-request-client';
import { NewApiKeysClient } from './newapi-keys-client';

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
const SITE_USER_ID = '42';

interface Call {
  url: string;
  options: SessionRequestOptions;
}

/** 记录型 session client：按 URL 是否含 `/key` 返回不同响应，捕获每次调用。 */
function createClient(
  onList: () => SessionResponse,
  onReveal: () => SessionResponse = () => ({ status: 200, headers: {}, bodyText: '{}' }),
): { client: SessionRequestClient; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    client: {
      fetchWithSession: async (url, options) => {
        calls.push({ url, options });
        return url.includes('/key') ? onReveal() : onList();
      },
    },
  };
}

function listBody(tokens: unknown[]): SessionResponse {
  return { status: 200, headers: {}, bodyText: JSON.stringify({ success: true, data: { items: tokens } }) };
}

function baseRequest(overrides: Partial<{ accountId: string; baseUrl: string; siteUserId: string }> = {}) {
  return {
    accountId: ACCOUNT_ID,
    baseUrl: 'https://demo.example.com',
    siteUserId: SITE_USER_ID,
    ...overrides,
  };
}

describe('NewApiKeysClient.listByAccount', () => {
  it('requests /api/token/ with the account partition and New-Api-User header', async () => {
    const { client, calls } = createClient(() =>
      listBody([{ id: 1, key: 'sk-abcdefghwxyz', name: 'k1', status: 1 }]),
    );
    const keysClient = new NewApiKeysClient({ sessionClient: client });

    const records = await keysClient.listByAccount(baseRequest());

    expect(records).toHaveLength(1);
    // 列表视图始终脱敏，绝不返回完整明文。
    expect(records[0].maskedKey).not.toBe('sk-abcdefghwxyz');

    const url = new URL(calls[0].url);
    expect(url.pathname).toBe('/api/token/');
    expect(Object.fromEntries(url.searchParams)).toEqual({ p: '0', size: '100' });
    expect(calls[0].options.partition).toBe(getAccountPartition(ACCOUNT_ID));
    expect(calls[0].options.headers).toMatchObject({ 'New-Api-User': SITE_USER_ID });
  });

  it('returns an empty list (never throws) for an empty token array', async () => {
    const { client } = createClient(() => listBody([]));
    const keysClient = new NewApiKeysClient({ sessionClient: client });

    await expect(keysClient.listByAccount(baseRequest())).resolves.toEqual([]);
  });

  it('maps 401 to SESSION_EXPIRED before parsing', async () => {
    const { client } = createClient(() => ({ status: 401, headers: {}, bodyText: '{"success":false}' }));
    const keysClient = new NewApiKeysClient({ sessionClient: client });

    await expect(keysClient.listByAccount(baseRequest())).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });

  it('maps 403 to UPSTREAM_FORBIDDEN', async () => {
    const { client } = createClient(() => ({ status: 403, headers: {}, bodyText: '' }));
    const keysClient = new NewApiKeysClient({ sessionClient: client });

    await expect(keysClient.listByAccount(baseRequest())).rejects.toMatchObject({ code: 'UPSTREAM_FORBIDDEN' });
  });

  it('maps 500 to UPSTREAM_UNAVAILABLE', async () => {
    const { client } = createClient(() => ({ status: 500, headers: {}, bodyText: '' }));
    const keysClient = new NewApiKeysClient({ sessionClient: client });

    await expect(keysClient.listByAccount(baseRequest())).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
  });

  it('maps a truncated response to UPSTREAM_INVALID_RESPONSE', async () => {
    const { client } = createClient(() => ({
      status: 200,
      headers: {},
      bodyText: JSON.stringify({ success: true, data: { items: [] } }),
      truncated: true,
    }));
    const keysClient = new NewApiKeysClient({ sessionClient: client });

    await expect(keysClient.listByAccount(baseRequest())).rejects.toMatchObject({ code: 'UPSTREAM_INVALID_RESPONSE' });
  });

  it('maps an unparsable 200 body to UPSTREAM_INVALID_RESPONSE', async () => {
    const { client } = createClient(() => ({ status: 200, headers: {}, bodyText: '<html>login</html>' }));
    const keysClient = new NewApiKeysClient({ sessionClient: client });

    await expect(keysClient.listByAccount(baseRequest())).rejects.toMatchObject({ code: 'UPSTREAM_INVALID_RESPONSE' });
  });

  it('keeps partition and header isolated for two accounts on the same base URL', async () => {
    const { client, calls } = createClient(() => listBody([]));
    const keysClient = new NewApiKeysClient({ sessionClient: client });
    const other = '00000000-0000-4000-8000-000000000002';

    await keysClient.listByAccount(baseRequest());
    await keysClient.listByAccount(baseRequest({ accountId: other, siteUserId: '99' }));

    expect(calls[0].options.partition).toBe(getAccountPartition(ACCOUNT_ID));
    expect(calls[1].options.partition).toBe(getAccountPartition(other));
    expect(calls[0].options.partition).not.toBe(calls[1].options.partition);
    expect(calls[0].options.headers).toMatchObject({ 'New-Api-User': SITE_USER_ID });
    expect(calls[1].options.headers).toMatchObject({ 'New-Api-User': '99' });
  });
});

describe('NewApiKeysClient.reveal', () => {
  it('returns the plaintext directly when the listed key is not masked', async () => {
    const { client, calls } = createClient(() =>
      listBody([{ id: 1, key: 'sk-plainfullkey1234', name: 'k1' }]),
    );
    const keysClient = new NewApiKeysClient({ sessionClient: client });

    await expect(keysClient.reveal(baseRequest(), 1)).resolves.toBe('sk-plainfullkey1234');
    // 未脱敏时不应发起 reveal POST。
    expect(calls.some(call => call.url.includes('/key'))).toBe(false);
    expect(calls[0].options.headers).toMatchObject({ 'New-Api-User': SITE_USER_ID });
  });

  it('falls back to POST /api/token/{id}/key with the header when the listed key is masked', async () => {
    const { client, calls } = createClient(
      () => listBody([{ id: 1, key: 'sk-a***1234', name: 'k1' }]),
      () => ({ status: 200, headers: {}, bodyText: JSON.stringify({ success: true, data: { key: 'sk-realsecret9999' } }) }),
    );
    const keysClient = new NewApiKeysClient({ sessionClient: client });

    await expect(keysClient.reveal(baseRequest(), 1)).resolves.toBe('sk-realsecret9999');

    const revealCall = calls.find(call => call.url.includes('/api/token/1/key'));
    expect(revealCall).toBeDefined();
    expect(revealCall?.options.method).toBe('POST');
    expect(revealCall?.options.headers).toMatchObject({ 'New-Api-User': SITE_USER_ID });
  });

  it('throws NOT_FOUND when the key cannot be revealed', async () => {
    const { client } = createClient(
      () => listBody([{ id: 1, key: 'sk-a***1234', name: 'k1' }]),
      () => ({ status: 200, headers: {}, bodyText: JSON.stringify({ success: false }) }),
    );
    const keysClient = new NewApiKeysClient({ sessionClient: client });

    await expect(keysClient.reveal(baseRequest(), 1)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
