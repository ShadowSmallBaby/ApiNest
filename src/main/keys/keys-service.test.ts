import { KeysService } from './keys-service';
import type { ApiKeyRecord } from '../../shared/ipc/bridge';
import type { AccountEntity } from '../storage/repositories/account-repository';
import type { NewApiKeysRequest } from '../adapters/newapi/newapi-keys-client';

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
const SITE_USER_ID = '42';

function makeAccount(overrides: Partial<AccountEntity> = {}): AccountEntity {
  return {
    id: ACCOUNT_ID,
    siteId: '00000000-0000-4000-8000-0000000000ff',
    siteName: 'Site',
    platform: 'newapi',
    baseUrl: 'https://api.example.com',
    displayName: 'acct',
    note: undefined,
    linuxDoClientId: undefined,
    routeProfile: 'modern',
    authRefId: null,
    recordVersion: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeRecord(): ApiKeyRecord {
  return {
    id: 1,
    accountId: ACCOUNT_ID,
    name: 'default',
    maskedKey: 'sk-…mnop',
    remainQuota: 100,
    unlimitedQuota: false,
    usedQuota: 10,
    status: 1,
    createdTime: 0,
    expiredTime: -1,
  };
}

const withSiteUserId = { getSiteUserId: () => SITE_USER_ID };

describe('KeysService.listByAccount', () => {
  it('resolves baseUrl + site user id and delegates to the client', async () => {
    let received: NewApiKeysRequest | null = null;
    const service = new KeysService({
      accountRepository: { get: () => makeAccount() },
      authStateRepository: withSiteUserId,
      keysClient: {
        listByAccount: async request => {
          received = request;
          return [makeRecord()];
        },
        reveal: async () => 'sk-full',
      },
    });

    const result = await service.listByAccount(ACCOUNT_ID);
    expect(result).toHaveLength(1);
    expect(received).toEqual({
      accountId: ACCOUNT_ID,
      baseUrl: 'https://api.example.com',
      siteUserId: SITE_USER_ID,
    });
  });

  it('throws ACCOUNT_NOT_FOUND when the account is missing', async () => {
    const service = new KeysService({
      accountRepository: { get: () => null },
      authStateRepository: withSiteUserId,
      keysClient: {
        listByAccount: async () => [],
        reveal: async () => '',
      },
    });

    await expect(service.listByAccount(ACCOUNT_ID)).rejects.toMatchObject({
      code: 'ACCOUNT_NOT_FOUND',
    });
  });

  it('throws NOT_IMPLEMENTED for non-newapi platforms', async () => {
    const service = new KeysService({
      accountRepository: { get: () => makeAccount({ platform: 'sub2api' }) },
      authStateRepository: withSiteUserId,
      keysClient: {
        listByAccount: async () => [],
        reveal: async () => '',
      },
    });

    await expect(service.listByAccount(ACCOUNT_ID)).rejects.toMatchObject({
      code: 'NOT_IMPLEMENTED',
    });
  });

  it('throws AUTH_METADATA_REQUIRED and never calls the client when site user id is missing', async () => {
    let called = false;
    const service = new KeysService({
      accountRepository: { get: () => makeAccount() },
      authStateRepository: { getSiteUserId: () => null },
      keysClient: {
        listByAccount: async () => {
          called = true;
          return [];
        },
        reveal: async () => '',
      },
    });

    await expect(service.listByAccount(ACCOUNT_ID)).rejects.toMatchObject({
      code: 'AUTH_METADATA_REQUIRED',
    });
    expect(called).toBe(false);
  });
});

describe('KeysService.reveal', () => {
  it('delegates to the client with the resolved request and token id', async () => {
    let receivedTokenId: number | null = null;
    let receivedRequest: NewApiKeysRequest | null = null;
    const service = new KeysService({
      accountRepository: { get: () => makeAccount() },
      authStateRepository: withSiteUserId,
      keysClient: {
        listByAccount: async () => [],
        reveal: async (request, tokenId) => {
          receivedRequest = request;
          receivedTokenId = tokenId;
          return 'sk-fullsecret';
        },
      },
    });

    const key = await service.reveal(ACCOUNT_ID, 42);
    expect(key).toBe('sk-fullsecret');
    expect(receivedTokenId).toBe(42);
    expect(receivedRequest).toMatchObject({ siteUserId: SITE_USER_ID });
  });

  it('throws ACCOUNT_NOT_FOUND when the account is missing', async () => {
    const service = new KeysService({
      accountRepository: { get: () => null },
      authStateRepository: withSiteUserId,
      keysClient: {
        listByAccount: async () => [],
        reveal: async () => '',
      },
    });

    await expect(service.reveal(ACCOUNT_ID, 1)).rejects.toMatchObject({
      code: 'ACCOUNT_NOT_FOUND',
    });
  });
});
