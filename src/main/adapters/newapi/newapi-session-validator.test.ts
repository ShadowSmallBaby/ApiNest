import { getAccountPartition } from '../../auth/account-partition';
import type {
  SessionRequestClient,
  SessionRequestOptions,
  SessionResponse,
} from '../session-request-client';
import { NewApiSessionValidator } from './newapi-session-validator';

describe('NewApiSessionValidator', () => {
  function createRecordingClient(
    response: SessionResponse | (() => Promise<SessionResponse>),
  ): { client: SessionRequestClient; calls: Array<{ url: string; options: SessionRequestOptions }> } {
    const calls: Array<{ url: string; options: SessionRequestOptions }> = [];
    return {
      calls,
      client: {
        fetchWithSession: async (url: string, options: SessionRequestOptions) => {
          calls.push({ url, options });
          return typeof response === 'function' ? response() : response;
        },
      },
    };
  }

  const request = {
    accountId: '11111111-1111-4111-8111-111111111111',
    baseUrl: 'https://example.com',
    platform: 'newapi' as const,
    siteUserId: '42',
  };

  it('maps an authenticated response to active and sends the New-Api-User header', async () => {
    const { client, calls } = createRecordingClient({
      status: 200,
      headers: {},
      bodyText: JSON.stringify({ success: true, data: { id: 42, username: 'alice' } }),
    });
    const validator = new NewApiSessionValidator({ sessionClient: client });

    await expect(validator.validate(request)).resolves.toEqual({ state: 'active' });
    // partition 必须由 accountId 派生。
    expect(calls[0].options.partition).toBe(getAccountPartition(request.accountId));
    expect(calls[0].url).toBe('https://example.com/api/user/self');
    // 受保护请求必须携带站内用户 ID 头。
    expect(calls[0].options.headers).toMatchObject({ 'New-Api-User': '42' });
  });

  it('returns expired without any request when site user id is missing', async () => {
    const { client, calls } = createRecordingClient({ status: 200, headers: {}, bodyText: '{}' });
    const validator = new NewApiSessionValidator({ sessionClient: client });

    await expect(
      validator.validate({
        accountId: request.accountId,
        baseUrl: request.baseUrl,
        platform: request.platform,
      }),
    ).resolves.toEqual({ state: 'expired' });
    expect(calls).toHaveLength(0);
  });

  it('maps 401 to expired', async () => {
    const { client } = createRecordingClient({ status: 401, headers: {}, bodyText: '' });
    const validator = new NewApiSessionValidator({ sessionClient: client });

    await expect(validator.validate(request)).resolves.toEqual({ state: 'expired' });
  });

  it('maps a balance-only 200 to unknown, never active', async () => {
    const { client } = createRecordingClient({
      status: 200,
      headers: {},
      bodyText: JSON.stringify({ success: true, data: { quota: 5000 } }),
    });
    const validator = new NewApiSessionValidator({ sessionClient: client });

    await expect(validator.validate(request)).resolves.toEqual({ state: 'unknown' });
  });

  it('records a network failure as error without throwing', async () => {
    const { client } = createRecordingClient(() => {
      throw new Error('connection refused');
    });
    const validator = new NewApiSessionValidator({ sessionClient: client });

    const outcome = await validator.validate(request);
    expect(outcome.state).toBe('error');
    if (outcome.state === 'error') {
      expect(outcome.errorCode).toBe('NETWORK_ERROR');
      // 错误摘要脱敏，不含原始异常信息。
      expect(outcome.errorSummary).not.toContain('connection refused');
    }
  });

  it('returns unknown for an invalid base url', async () => {
    const { client, calls } = createRecordingClient({ status: 200, headers: {}, bodyText: '{}' });
    const validator = new NewApiSessionValidator({ sessionClient: client });

    await expect(
      validator.validate({ ...request, baseUrl: 'not-a-valid-url' }),
    ).resolves.toEqual({ state: 'unknown' });
    // 无效 URL 不应发起任何请求。
    expect(calls).toHaveLength(0);
  });
});
