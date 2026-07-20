import { AuthIdentityService } from './auth-identity-service';
import type { AuthIdentityEntity, AuthIdentityRepository } from '../storage/repositories/auth-identity-repository';
import type { SiteCredentialPlaintext } from './site-credential-service';

/** 内存版 auth 身份仓储，避免依赖 better-sqlite3。 */
function makeRepository(): AuthIdentityRepository {
  const store = new Map<string, AuthIdentityEntity>();
  return {
    create: (entity: AuthIdentityEntity) => {
      store.set(entity.id, entity);
    },
    list: () => Array.from(store.values()),
    get: (id: string) => store.get(id) ?? null,
    update: (entity: AuthIdentityEntity) => {
      store.set(entity.id, entity);
    },
    delete: (id: string) => {
      store.delete(id);
    },
  } as unknown as AuthIdentityRepository;
}

/** 内存版凭据端口，只记录 authId → 明文，验证按 authId 存取。 */
function makeCredentials(): {
  port: { save: (id: string, p: SiteCredentialPlaintext) => void; has: (id: string) => boolean; clear: (id: string) => void };
  store: Map<string, SiteCredentialPlaintext>;
} {
  const store = new Map<string, SiteCredentialPlaintext>();
  return {
    store,
    port: {
      save: (id, plaintext) => {
        store.set(id, plaintext);
      },
      has: id => store.has(id),
      clear: id => {
        store.delete(id);
      },
    },
  };
}

let counter = 0;
const generateId = (): string => `auth-${++counter}`;

describe('AuthIdentityService', () => {
  beforeEach(() => {
    counter = 0;
  });

  it('创建 github/linuxdo 身份不涉及凭据，hasCredential 恒为 false', () => {
    const credentials = makeCredentials();
    const service = new AuthIdentityService({ repository: makeRepository(), credentials: credentials.port, generateId });

    const github = service.create({ kind: 'github', label: '我的 GitHub' });
    expect(github.kind).toBe('github');
    expect(github.hasCredential).toBe(false);
    expect(credentials.store.size).toBe(0);
  });

  it('password 身份保存凭据后 hasCredential 为 true，凭据按 authId 存储', () => {
    const credentials = makeCredentials();
    const service = new AuthIdentityService({ repository: makeRepository(), credentials: credentials.port, generateId });

    const identity = service.create({ kind: 'password', label: '站点账密' });
    service.saveCredential(identity.id, { username: 'alice', password: 'secret-pw' });

    expect(credentials.store.get(identity.id)).toEqual({ username: 'alice', password: 'secret-pw' });
    expect(service.get(identity.id).hasCredential).toBe(true);
  });

  it('非 password 身份保存凭据被拒绝', () => {
    const credentials = makeCredentials();
    const service = new AuthIdentityService({ repository: makeRepository(), credentials: credentials.port, generateId });

    const github = service.create({ kind: 'github', label: 'GH' });
    expect(() => service.saveCredential(github.id, { username: 'x', password: 'y' })).toThrow(/password/);
  });

  it('删除 password 身份同步清除其凭据', () => {
    const credentials = makeCredentials();
    const service = new AuthIdentityService({ repository: makeRepository(), credentials: credentials.port, generateId });

    const identity = service.create({ kind: 'password', label: '站点账密' });
    service.saveCredential(identity.id, { username: 'a', password: 'b' });
    service.remove(identity.id);

    expect(credentials.store.has(identity.id)).toBe(false);
    expect(() => service.get(identity.id)).toThrow();
  });

  it('list 返回视图不含任何凭据明文', () => {
    const credentials = makeCredentials();
    const service = new AuthIdentityService({ repository: makeRepository(), credentials: credentials.port, generateId });

    const identity = service.create({ kind: 'password', label: '站点账密' });
    service.saveCredential(identity.id, { username: 'alice', password: 'super-secret' });

    const serialized = JSON.stringify(service.list());
    expect(serialized).not.toContain('super-secret');
    expect(serialized).not.toContain('alice');
  });

  it('未知身份的操作抛出错误', () => {
    const credentials = makeCredentials();
    const service = new AuthIdentityService({ repository: makeRepository(), credentials: credentials.port, generateId });

    expect(() => service.get('missing')).toThrow();
    expect(() => service.update('missing', { label: 'x' })).toThrow();
    expect(() => service.remove('missing')).toThrow();
  });
});
