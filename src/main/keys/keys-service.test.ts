import { KeysService } from './keys-service';
import type { ApiKeyRecord } from '../../shared/ipc/bridge';
import type { AccountEntity } from '../storage/repositories/account-repository';
import type {
  AccountKeyEntity,
  ReplaceAccountKeysInput,
} from '../storage/repositories/account-keys-repository';
import type { NewApiKeysRequest } from '../adapters/newapi/newapi-keys-client';

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
const SITE_ID = '00000000-0000-4000-8000-0000000000ff';
const SITE_USER_ID = '42';

function makeAccount(overrides: Partial<AccountEntity> = {}): AccountEntity {
  return {
    id: ACCOUNT_ID,
    siteId: SITE_ID,
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

function makeEntity(overrides: Partial<AccountKeyEntity> = {}): AccountKeyEntity {
  return {
    tokenId: 1,
    siteId: SITE_ID,
    accountId: ACCOUNT_ID,
    name: 'default',
    maskedKey: 'sk-…mnop',
    group: undefined,
    remainQuota: 100,
    unlimitedQuota: false,
    usedQuota: 10,
    status: 1,
    createdTime: 0,
    expiredTime: -1,
    plaintextSecretId: undefined,
    capturedAt: undefined,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeRemoteRecord(overrides: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
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
    hasPlaintext: false,
    ...overrides,
  };
}

const withSiteUserId = { getSiteUserId: () => SITE_USER_ID };

/** 可配置的假仓储，记录调用便于断言。 */
function makeRepository(initial: AccountKeyEntity[] = []) {
  let rows = [...initial];
  const calls = {
    replace: [] as ReplaceAccountKeysInput[],
    attach: [] as Array<{ tokenId: number; secretId: string }>,
  };
  return {
    rows: () => rows,
    calls,
    listByAccount: () => rows,
    get: (tokenId: number) => rows.find(row => row.tokenId === tokenId) ?? null,
    replaceAccountMetadata: (input: ReplaceAccountKeysInput) => {
      calls.replace.push(input);
      // 模拟：保留旧行明文引用，按远程列表覆盖元数据，删除远程消失行。
      const incoming = new Set(input.records.map(record => record.tokenId));
      const orphanSecretIds = rows
        .filter(row => !incoming.has(row.tokenId) && row.plaintextSecretId)
        .map(row => row.plaintextSecretId as string);
      rows = input.records.map(record => {
        const existing = rows.find(row => row.tokenId === record.tokenId);
        return makeEntity({
          ...record,
          plaintextSecretId: existing?.plaintextSecretId,
          capturedAt: existing?.capturedAt,
        });
      });
      return { orphanSecretIds };
    },
    attachPlaintext: (tokenId: number, _siteId: string, secretId: string, capturedAt: string) => {
      calls.attach.push({ tokenId, secretId });
      rows = rows.map(row =>
        row.tokenId === tokenId ? { ...row, plaintextSecretId: secretId, capturedAt } : row,
      );
    },
  };
}

function makeVault() {
  const store = new Map<string, string>();
  const deleted: string[] = [];
  return {
    store,
    deleted,
    storeSecret: (secretId: string, _accountId: string, _purpose: string, plaintext: string) => {
      store.set(secretId, plaintext);
    },
    readSecret: (secretId: string) => store.get(secretId) ?? null,
    deleteSecret: (secretId: string) => {
      store.delete(secretId);
      deleted.push(secretId);
    },
  };
}

describe('KeysService.listByAccount', () => {
  it('reads local rows without hitting the network', async () => {
    let networkCalled = false;
    const service = new KeysService({
      accountRepository: { get: () => makeAccount() },
      authStateRepository: withSiteUserId,
      keysClient: {
        listByAccount: async () => {
          networkCalled = true;
          return [];
        },
        reveal: async () => '',
      },
      keysRepository: makeRepository([makeEntity(), makeEntity({ tokenId: 2, plaintextSecretId: 's2' })]),
      vault: makeVault(),
    });

    const result = await service.listByAccount(ACCOUNT_ID);
    expect(networkCalled).toBe(false);
    expect(result).toHaveLength(2);
    expect(result[0].hasPlaintext).toBe(false);
    expect(result[1].hasPlaintext).toBe(true);
  });

  it('throws ACCOUNT_NOT_FOUND when the account is missing', async () => {
    const service = new KeysService({
      accountRepository: { get: () => null },
      authStateRepository: withSiteUserId,
      keysClient: { listByAccount: async () => [], reveal: async () => '' },
      keysRepository: makeRepository(),
      vault: makeVault(),
    });
    await expect(service.listByAccount(ACCOUNT_ID)).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
  });

  it('throws NOT_IMPLEMENTED for non-newapi platforms', async () => {
    const service = new KeysService({
      accountRepository: { get: () => makeAccount({ platform: 'sub2api' }) },
      authStateRepository: withSiteUserId,
      keysClient: { listByAccount: async () => [], reveal: async () => '' },
      keysRepository: makeRepository(),
      vault: makeVault(),
    });
    await expect(service.listByAccount(ACCOUNT_ID)).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
  });
});

describe('KeysService.refresh', () => {
  it('fetches remote and overwrites local metadata while keeping plaintext refs', async () => {
    const repository = makeRepository([makeEntity({ tokenId: 1, plaintextSecretId: 's1' })]);
    let received: NewApiKeysRequest | null = null;
    const service = new KeysService({
      accountRepository: { get: () => makeAccount() },
      authStateRepository: withSiteUserId,
      keysClient: {
        listByAccount: async request => {
          received = request;
          return [makeRemoteRecord({ id: 1, name: 'renamed' }), makeRemoteRecord({ id: 3, name: 'new' })];
        },
        reveal: async () => '',
      },
      keysRepository: repository,
      vault: makeVault(),
    });

    const result = await service.refresh(ACCOUNT_ID);
    expect(received).toEqual({ accountId: ACCOUNT_ID, baseUrl: 'https://api.example.com', siteUserId: SITE_USER_ID });
    expect(result.map(r => r.id)).toEqual([1, 3]);
    // token 1 保留明文引用，token 3 无明文。
    expect(result.find(r => r.id === 1)?.hasPlaintext).toBe(true);
    expect(result.find(r => r.id === 3)?.hasPlaintext).toBe(false);
  });

  it('deletes orphan secrets for keys removed remotely', async () => {
    const repository = makeRepository([
      makeEntity({ tokenId: 1, plaintextSecretId: 's1' }),
      makeEntity({ tokenId: 2, plaintextSecretId: 's2' }),
    ]);
    const vault = makeVault();
    vault.store.set('s1', 'sk-one');
    vault.store.set('s2', 'sk-two');
    const service = new KeysService({
      accountRepository: { get: () => makeAccount() },
      authStateRepository: withSiteUserId,
      keysClient: {
        listByAccount: async () => [makeRemoteRecord({ id: 1 })], // token 2 远程已删
        reveal: async () => '',
      },
      keysRepository: repository,
      vault,
    });

    await service.refresh(ACCOUNT_ID);
    expect(vault.deleted).toEqual(['s2']);
    expect(vault.store.has('s2')).toBe(false);
    expect(vault.store.has('s1')).toBe(true);
  });

  it('throws AUTH_METADATA_REQUIRED when site user id is missing', async () => {
    let networkCalled = false;
    const service = new KeysService({
      accountRepository: { get: () => makeAccount() },
      authStateRepository: { getSiteUserId: () => null },
      keysClient: {
        listByAccount: async () => {
          networkCalled = true;
          return [];
        },
        reveal: async () => '',
      },
      keysRepository: makeRepository(),
      vault: makeVault(),
    });
    await expect(service.refresh(ACCOUNT_ID)).rejects.toMatchObject({ code: 'AUTH_METADATA_REQUIRED' });
    expect(networkCalled).toBe(false);
  });
});

describe('KeysService.reveal', () => {
  it('decrypts locally without network when plaintext is already stored', async () => {
    let networkCalled = false;
    const vault = makeVault();
    vault.store.set('s1', 'sk-fullsecret');
    const service = new KeysService({
      accountRepository: { get: () => makeAccount() },
      authStateRepository: { getSiteUserId: () => null }, // 离线路径不应要求站内用户 ID
      keysClient: {
        listByAccount: async () => [],
        reveal: async () => {
          networkCalled = true;
          return 'sk-network';
        },
      },
      keysRepository: makeRepository([makeEntity({ tokenId: 1, plaintextSecretId: 's1' })]),
      vault,
    });

    const key = await service.reveal(ACCOUNT_ID, 1);
    expect(key).toBe('sk-fullsecret');
    expect(networkCalled).toBe(false);
  });

  it('fetches over network, encrypts and attaches when not stored', async () => {
    const repository = makeRepository([makeEntity({ tokenId: 1 })]);
    const vault = makeVault();
    const service = new KeysService({
      accountRepository: { get: () => makeAccount() },
      authStateRepository: withSiteUserId,
      keysClient: {
        listByAccount: async () => [],
        reveal: async () => 'sk-fetched',
      },
      keysRepository: repository,
      vault,
    });

    const key = await service.reveal(ACCOUNT_ID, 1);
    expect(key).toBe('sk-fetched');
    expect(repository.calls.attach).toHaveLength(1);
    expect(vault.store.get('account-key:' + SITE_ID + ':1')).toBe('sk-fetched');
    // 入库后本地行标记已有明文。
    expect(repository.get(1)?.plaintextSecretId).toBe('account-key:' + SITE_ID + ':1');
  });

  it('throws ACCOUNT_NOT_FOUND when the account is missing', async () => {
    const service = new KeysService({
      accountRepository: { get: () => null },
      authStateRepository: withSiteUserId,
      keysClient: { listByAccount: async () => [], reveal: async () => '' },
      keysRepository: makeRepository(),
      vault: makeVault(),
    });
    await expect(service.reveal(ACCOUNT_ID, 1)).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
  });
});

describe('KeysService.captureAll', () => {
  it('captures only pending keys and reports counts without leaking plaintext', async () => {
    const repository = makeRepository([
      makeEntity({ tokenId: 1 }),
      makeEntity({ tokenId: 2, plaintextSecretId: 's2' }), // 已入库，跳过
      makeEntity({ tokenId: 3 }),
    ]);
    const vault = makeVault();
    const service = new KeysService({
      accountRepository: { get: () => makeAccount() },
      authStateRepository: withSiteUserId,
      keysClient: {
        listByAccount: async () => [],
        reveal: async (_request, tokenId) => {
          if (tokenId === 3) throw new Error('boom');
          return `sk-${tokenId}`;
        },
      },
      keysRepository: repository,
      vault,
    });

    const result = await service.captureAll(ACCOUNT_ID);
    expect(result).toEqual({ accountId: ACCOUNT_ID, total: 2, captured: 1, failed: 1 });
    expect(vault.store.get('account-key:' + SITE_ID + ':1')).toBe('sk-1');
  });

  it('returns zeros when everything is already captured', async () => {
    const service = new KeysService({
      accountRepository: { get: () => makeAccount() },
      authStateRepository: withSiteUserId,
      keysClient: {
        listByAccount: async () => [],
        reveal: async () => 'sk',
      },
      keysRepository: makeRepository([makeEntity({ tokenId: 1, plaintextSecretId: 's1' })]),
      vault: makeVault(),
    });

    const result = await service.captureAll(ACCOUNT_ID);
    expect(result).toEqual({ accountId: ACCOUNT_ID, total: 0, captured: 0, failed: 0 });
  });
});
