import { AuthIdentityLoginFlow } from './auth-identity-login-flow';
import type { AuthIdentityEntity } from '../storage/repositories/auth-identity-repository';
import { getAuthPartition } from './account-partition';

const GITHUB_ID = '00000000-0000-4000-8000-0000000000g1'.replace(/g/g, 'a');
const PASSWORD_ID = '00000000-0000-4000-8000-0000000000p1'.replace(/p/g, 'b');

function makeEntity(overrides: Partial<AuthIdentityEntity> = {}): AuthIdentityEntity {
  return {
    id: GITHUB_ID,
    kind: 'github',
    label: '我的 GitHub',
    note: undefined,
    useProxy: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

interface OpenCall {
  accountId: string;
  partition?: string;
  baseUrl: string;
  startUrl: string;
  redirectDomains?: string[];
}

function makeFlow(entity: AuthIdentityEntity | null) {
  const openCalls: OpenCall[] = [];
  const flow = new AuthIdentityLoginFlow({
    repository: { get: () => entity },
    browserContainer: {
      open: (request: OpenCall) => {
        openCalls.push(request);
        return {} as ReturnType<import('../browser/browser-container').ControlledBrowserContainer['open']>;
      },
    },
  });
  return { flow, openCalls };
}

describe('AuthIdentityLoginFlow', () => {
  it('github 身份在 auth 专属 partition 打开 IdP 登录页', async () => {
    const entity = makeEntity({ kind: 'github' });
    const { flow, openCalls } = makeFlow(entity);

    const result = await flow.open(entity.id);

    expect(openCalls).toHaveLength(1);
    expect(openCalls[0].partition).toBe(getAuthPartition(entity.id));
    expect(openCalls[0].startUrl).toBe('https://github.com/login');
    expect(openCalls[0].redirectDomains).toEqual(['github.com']);
    expect(result.authState).toBe('unknown');
  });

  it('linuxdo 身份打开 connect.linux.do，并放行论坛与 connect', async () => {
    const entity = makeEntity({ kind: 'linuxdo' });
    const { flow, openCalls } = makeFlow(entity);

    await flow.open(entity.id);

    expect(openCalls[0].startUrl).toBe('https://connect.linux.do/');
    expect(openCalls[0].redirectDomains).toEqual(['connect.linux.do', 'linux.do']);
  });

  it('auth 专属 partition 不与任何账户 partition 相同', () => {
    const entity = makeEntity({ kind: 'github' });
    const { flow, openCalls } = makeFlow(entity);

    flow.open(entity.id);

    // auth partition 前缀独立，绝不与账户 partition 冲突。
    expect(openCalls[0].partition).toContain('apinest-auth-');
    expect(openCalls[0].partition).not.toContain('apinest-account-');
  });

  it('password 类型没有交互式登录，直接拒绝', async () => {
    const entity = makeEntity({ id: PASSWORD_ID, kind: 'password' });
    const { flow, openCalls } = makeFlow(entity);

    await expect(flow.open(entity.id)).rejects.toThrow();
    expect(openCalls).toHaveLength(0);
  });

  it('身份不存在时拒绝', async () => {
    const { flow, openCalls } = makeFlow(null);

    await expect(flow.open(GITHUB_ID)).rejects.toThrow();
    expect(openCalls).toHaveLength(0);
  });
});
