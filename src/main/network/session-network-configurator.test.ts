import { describe, expect, it, vi } from 'vitest';
import { SessionNetworkConfigurator, type ProxyCapableSession } from './session-network-configurator';
import type { CompiledProxyConfig } from './network-types';

function makeSession(): { session: ProxyCapableSession; calls: string[] } {
  const calls: string[] = [];
  const session: ProxyCapableSession = {
    setProxy: vi.fn(async (config: CompiledProxyConfig) => {
      calls.push(`setProxy:${config.mode}`);
    }),
    closeAllConnections: vi.fn(async () => {
      calls.push('closeAllConnections');
    }),
  };
  return { session, calls };
}

describe('SessionNetworkConfigurator', () => {
  it('applies setProxy on first ensure without closing connections', async () => {
    const configurator = new SessionNetworkConfigurator();
    const { session, calls } = makeSession();
    await configurator.ensure('p', session, { mode: 'direct' });
    expect(calls).toEqual(['setProxy:direct']);
  });

  it('skips re-apply when the fingerprint is unchanged', async () => {
    const configurator = new SessionNetworkConfigurator();
    const { session, calls } = makeSession();
    await configurator.ensure('p', session, { mode: 'direct' });
    await configurator.ensure('p', session, { mode: 'direct' });
    expect(calls).toEqual(['setProxy:direct']);
  });

  it('re-applies and closes connections when the config changes', async () => {
    const configurator = new SessionNetworkConfigurator();
    const { session, calls } = makeSession();
    await configurator.ensure('p', session, { mode: 'direct' });
    await configurator.ensure('p', session, { mode: 'fixed_servers', proxyRules: 'socks5://h:1' });
    expect(calls).toEqual(['setProxy:direct', 'setProxy:fixed_servers', 'closeAllConnections']);
  });

  it('invalidate forces a hot switch (setProxy then closeAllConnections)', async () => {
    const configurator = new SessionNetworkConfigurator();
    const { session, calls } = makeSession();
    await configurator.ensure('p', session, { mode: 'direct' });
    configurator.invalidate('p');
    await configurator.ensure('p', session, { mode: 'direct' });
    expect(calls).toEqual(['setProxy:direct', 'setProxy:direct', 'closeAllConnections']);
  });

  it('fails closed and rethrows when setProxy errors, allowing a later retry', async () => {
    const configurator = new SessionNetworkConfigurator();
    const failing: ProxyCapableSession = {
      setProxy: vi.fn(async () => {
        throw new Error('boom');
      }),
      closeAllConnections: vi.fn(async () => {}),
    };
    await expect(configurator.ensure('p', failing, { mode: 'direct' })).rejects.toThrow();

    const retry: ProxyCapableSession = {
      setProxy: vi.fn(async () => {}),
      closeAllConnections: vi.fn(async () => {}),
    };
    await expect(configurator.ensure('p', retry, { mode: 'direct' })).resolves.toBeUndefined();
    expect(retry.setProxy).toHaveBeenCalledTimes(1);
  });

  it('shares a single setProxy across concurrent first ensures for one partition', async () => {
    const configurator = new SessionNetworkConfigurator();
    const { session, calls } = makeSession();
    await Promise.all([
      configurator.ensure('p', session, { mode: 'direct' }),
      configurator.ensure('p', session, { mode: 'direct' }),
      configurator.ensure('p', session, { mode: 'direct' }),
    ]);
    expect(calls.filter(call => call === 'setProxy:direct')).toHaveLength(1);
  });

  it('keeps partitions isolated', async () => {
    const configurator = new SessionNetworkConfigurator();
    const a = makeSession();
    const b = makeSession();
    await configurator.ensure('a', a.session, { mode: 'direct' });
    await configurator.ensure('b', b.session, { mode: 'system' });
    expect(a.calls).toEqual(['setProxy:direct']);
    expect(b.calls).toEqual(['setProxy:system']);
  });
});
