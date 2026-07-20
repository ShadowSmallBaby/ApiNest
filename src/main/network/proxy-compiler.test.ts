import { describe, expect, it } from 'vitest';
import { buildProxyRules, compileProxyConfig } from './proxy-compiler';
import type { ProxyTemplate } from './network-types';

describe('compileProxyConfig', () => {
  it('forces direct when useProxy is false regardless of template', () => {
    const fixed: ProxyTemplate = { mode: 'fixed', scheme: 'socks5', host: '127.0.0.1', port: 1080 };
    expect(compileProxyConfig(false, fixed)).toEqual({ mode: 'direct' });
    expect(compileProxyConfig(false, { mode: 'system' })).toEqual({ mode: 'direct' });
    expect(compileProxyConfig(false, { mode: 'direct' })).toEqual({ mode: 'direct' });
  });

  it('compiles direct/system templates as-is when useProxy is true', () => {
    expect(compileProxyConfig(true, { mode: 'direct' })).toEqual({ mode: 'direct' });
    expect(compileProxyConfig(true, { mode: 'system' })).toEqual({ mode: 'system' });
  });

  it('compiles fixed template into fixed_servers with structured proxyRules', () => {
    expect(
      compileProxyConfig(true, { mode: 'fixed', scheme: 'http', host: 'proxy.local', port: 8080 }),
    ).toEqual({ mode: 'fixed_servers', proxyRules: 'http://proxy.local:8080' });
    expect(
      compileProxyConfig(true, { mode: 'fixed', scheme: 'socks5', host: '10.0.0.1', port: 1080 }),
    ).toEqual({ mode: 'fixed_servers', proxyRules: 'socks5://10.0.0.1:1080' });
    expect(
      compileProxyConfig(true, { mode: 'fixed', scheme: 'https', host: 'sec.proxy', port: 443 }),
    ).toEqual({ mode: 'fixed_servers', proxyRules: 'https://sec.proxy:443' });
  });
});

describe('buildProxyRules', () => {
  it('builds scheme://host:port applying to all URL schemes', () => {
    expect(buildProxyRules({ mode: 'fixed', scheme: 'https', host: 'sec.proxy', port: 443 })).toBe(
      'https://sec.proxy:443',
    );
  });
});
