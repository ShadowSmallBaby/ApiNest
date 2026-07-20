import { TextApiTestService } from './text-api-test-service';
import type { AccountEntity } from '../storage/repositories/account-repository';
import type { ModelRecord, RunTextApiTestInput } from '../../shared/ipc/bridge';
import { getAccountPartition } from '../auth/account-partition';

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
const INPUT: RunTextApiTestInput = {
  accountId: ACCOUNT_ID,
  tokenId: 9,
  modelId: 'gpt-4o',
  category: 'text',
  endpoint: 'openai_chat_completions',
  message: 'hello',
};

function account(overrides: Partial<AccountEntity> = {}): AccountEntity {
  return {
    id: ACCOUNT_ID, siteId: 'site', siteName: 'Demo', platform: 'newapi',
    baseUrl: 'https://demo.example.com', displayName: 'Main', routeProfile: 'modern',
    authRefId: null, recordVersion: 1, createdAt: '', updatedAt: '', ...overrides,
  };
}

const MODEL: ModelRecord = {
  modelName: 'gpt-4o', quotaType: 0, modelRatio: 1, completionRatio: 1, modelPrice: 0,
  enableGroups: ['default'], supportedEndpointTypes: ['chat/completions'], availableForAccount: true,
};

describe('TextApiTestService', () => {
  it('resolves key only in main, sends a bounded request and redacts echoed key', async () => {
    let captured: unknown;
    let clock = 100;
    const service = new TextApiTestService({
      accountRepository: { get: () => account() },
      keysService: { reveal: async () => 'sk-secret' },
      modelsService: { listByAccount: async () => [MODEL] },
      sessionClient: {
        fetchWithSession: async (url, options) => {
          captured = { url, options };
          clock = 145;
          return {
            status: 200,
            headers: { 'content-type': 'application/json', 'x-request-id': 'req-1', 'set-cookie': 'private' },
            bodyText: '{"text":"ok","key":"sk-secret"}',
            truncated: false,
          };
        },
      },
      now: () => clock,
    });

    const result = await service.run(INPUT);
    expect(captured).toEqual({
      url: 'https://demo.example.com/v1/chat/completions',
      options: {
        partition: getAccountPartition(ACCOUNT_ID),
        method: 'POST',
        headers: {
          authorization: 'Bearer sk-secret',
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hello' }], stream: false }),
        bodyLimit: 2 * 1024 * 1024,
        timeoutMs: 60_000,
        redirect: 'manual',
      },
    });
    expect(result).toMatchObject({
      status: 200, ok: true, latencyMs: 45, contentType: 'application/json', requestId: 'req-1',
      bodyText: '{"text":"ok","key":"[REDACTED]"}', truncated: false,
    });
    expect(result).not.toHaveProperty('apiKey');
    expect(result).not.toHaveProperty('headers');
  });

  it('rejects unknown account, non-newapi account and unavailable model', async () => {
    const base = {
      keysService: { reveal: async () => 'key' },
      modelsService: { listByAccount: async () => [MODEL] },
      sessionClient: { fetchWithSession: async () => ({ status: 200, headers: {}, bodyText: '' }) },
    };
    await expect(new TextApiTestService({ ...base, accountRepository: { get: () => null } }).run(INPUT))
      .rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
    await expect(new TextApiTestService({ ...base, accountRepository: { get: () => account({ platform: 'sub2api' }) } }).run(INPUT))
      .rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
    await expect(new TextApiTestService({
      ...base,
      accountRepository: { get: () => account() },
      modelsService: { listByAccount: async () => [{ ...MODEL, availableForAccount: false }] },
    }).run(INPUT)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects a blank message when no custom body is supplied before revealing the key', async () => {
    let revealed = false;
    const service = new TextApiTestService({
      accountRepository: { get: () => account() },
      keysService: { reveal: async () => { revealed = true; return 'key'; } },
      modelsService: { listByAccount: async () => [MODEL] },
      sessionClient: { fetchWithSession: async () => ({ status: 200, headers: {}, bodyText: '' }) },
    });
    await expect(service.run({ ...INPUT, message: ' ' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(revealed).toBe(false);
  });

  it('uses a custom body as full replacement while locking model and stream', async () => {
    let requestBody = '';
    const service = new TextApiTestService({
      accountRepository: { get: () => account() },
      keysService: { reveal: async () => 'key' },
      modelsService: { listByAccount: async () => [MODEL] },
      sessionClient: {
        fetchWithSession: async (_url, options) => {
          requestBody = options.body ?? '';
          return { status: 400, headers: {}, bodyText: 'bad', truncated: true };
        },
      },
    });
    const result = await service.run({ ...INPUT, customBodyJson: '{"model":"other","stream":true,"temperature":0.2}' });
    expect(JSON.parse(requestBody)).toEqual({ model: 'gpt-4o', stream: false, temperature: 0.2 });
    expect(result).toMatchObject({ ok: false, status: 400, truncated: true });
  });
});
