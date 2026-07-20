import { SiteCredentialService, AUTH_IDENTITY_CREDENTIAL_PURPOSE } from './site-credential-service';

/** 内存版 Vault 端口：按 secretId 记录明文，模拟信封加密的存取语义。 */
function createFakeVault() {
  const store = new Map<string, { accountId: string; purpose: string; plaintext: string }>();

  return {
    store,
    storeSecret: (secretId: string, accountId: string, purpose: string, plaintext: string) => {
      store.set(secretId, { accountId, purpose, plaintext });
    },
    readSecret: (secretId: string) => store.get(secretId)?.plaintext ?? null,
    hasSecret: (secretId: string) => store.has(secretId),
    deleteSecret: (secretId: string) => {
      store.delete(secretId);
    },
  };
}

const AUTH_A = '00000000-0000-4000-8000-00000000000a';
const AUTH_B = '00000000-0000-4000-8000-00000000000b';

describe('SiteCredentialService', () => {
  it('按 authId 派生确定性 secretId，存取幂等', () => {
    const vault = createFakeVault();
    const service = new SiteCredentialService({ vault });

    service.save(AUTH_A, { username: 'alice', password: 'secret-1' });
    service.save(AUTH_A, { username: 'alice', password: 'secret-2' });

    // 幂等：同 auth 身份只有一条引用，覆盖而非新增。
    expect(vault.store.size).toBe(1);
    const key = `${AUTH_IDENTITY_CREDENTIAL_PURPOSE}:${AUTH_A}`;
    expect(vault.store.get(key)?.purpose).toBe(AUTH_IDENTITY_CREDENTIAL_PURPOSE);
    expect(vault.store.get(key)?.accountId).toBe(AUTH_A);
  });

  it('has 仅返回布尔存在性', () => {
    const vault = createFakeVault();
    const service = new SiteCredentialService({ vault });

    expect(service.has(AUTH_A)).toBe(false);
    service.save(AUTH_A, { username: 'alice', password: 'pw' });
    expect(service.has(AUTH_A)).toBe(true);
  });

  it('clear 只清除目标 auth 身份引用，不影响其他身份', () => {
    const vault = createFakeVault();
    const service = new SiteCredentialService({ vault });

    service.save(AUTH_A, { username: 'alice', password: 'pw-a' });
    service.save(AUTH_B, { username: 'bob', password: 'pw-b' });

    service.clear(AUTH_A);

    expect(service.has(AUTH_A)).toBe(false);
    expect(service.has(AUTH_B)).toBe(true);
  });

  it('reveal 还原明文，仅供主进程内使用', () => {
    const vault = createFakeVault();
    const service = new SiteCredentialService({ vault });

    service.save(AUTH_A, { username: 'alice', password: 'pw' });

    expect(service.reveal(AUTH_A)).toEqual({ username: 'alice', password: 'pw' });
  });

  it('reveal 未保存时返回 null', () => {
    const vault = createFakeVault();
    const service = new SiteCredentialService({ vault });

    expect(service.reveal(AUTH_A)).toBeNull();
  });

  it('reveal 遇到损坏数据时容错返回 null', () => {
    const vault = createFakeVault();
    const service = new SiteCredentialService({ vault });

    vault.store.set(`${AUTH_IDENTITY_CREDENTIAL_PURPOSE}:${AUTH_A}`, {
      accountId: AUTH_A,
      purpose: AUTH_IDENTITY_CREDENTIAL_PURPOSE,
      plaintext: 'not-json',
    });

    expect(service.reveal(AUTH_A)).toBeNull();
  });
});
