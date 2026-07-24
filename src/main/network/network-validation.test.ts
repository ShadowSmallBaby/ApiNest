import { describe, expect, it } from 'vitest';
import {
  normalizeDohServer,
  normalizeProxyHost,
  normalizeProxyPort,
  parseNetworkSettings,
  toRawNetworkSettings,
  type RawNetworkSettings,
} from './network-validation';

describe('normalizeDohServer', () => {
  it('accepts and trims an https DoH URL', () => {
    expect(normalizeDohServer('  https://cloudflare-dns.com/dns-query  ')).toBe(
      'https://cloudflare-dns.com/dns-query',
    );
  });

  it('rejects non-https, userinfo, fragment and empty', () => {
    expect(() => normalizeDohServer('http://dns.example/q')).toThrow();
    expect(() => normalizeDohServer('https://user:pass@dns.example/q')).toThrow();
    expect(() => normalizeDohServer('https://dns.example/q#frag')).toThrow();
    expect(() => normalizeDohServer('   ')).toThrow();
    expect(() => normalizeDohServer('not a url')).toThrow();
  });
});

describe('normalizeProxyHost', () => {
  it('accepts a bare hostname or IPv4', () => {
    expect(normalizeProxyHost(' 127.0.0.1 ')).toBe('127.0.0.1');
    expect(normalizeProxyHost('proxy.local')).toBe('proxy.local');
  });

  it('rejects scheme, port, separators and whitespace', () => {
    expect(() => normalizeProxyHost('http://x')).toThrow();
    expect(() => normalizeProxyHost('host:8080')).toThrow();
    expect(() => normalizeProxyHost('a,b')).toThrow();
    expect(() => normalizeProxyHost('a;b')).toThrow();
    expect(() => normalizeProxyHost('a b')).toThrow();
    expect(() => normalizeProxyHost('')).toThrow();
  });
});

describe('normalizeProxyPort', () => {
  it('accepts integers within [1, 65535]', () => {
    expect(normalizeProxyPort(1)).toBe(1);
    expect(normalizeProxyPort(7890)).toBe(7890);
    expect(normalizeProxyPort(65535)).toBe(65535);
  });

  it('rejects out-of-range and non-integer ports', () => {
    expect(() => normalizeProxyPort(0)).toThrow();
    expect(() => normalizeProxyPort(65536)).toThrow();
    expect(() => normalizeProxyPort(1.5)).toThrow();
    expect(() => normalizeProxyPort(Number.NaN)).toThrow();
  });
});

describe('parseNetworkSettings', () => {
  const base: RawNetworkSettings = {
    secureDnsMode: 'automatic',
    secureDnsServers: [],
    proxyMode: 'direct',
    fixedProxyScheme: null,
    fixedProxyHost: null,
    fixedProxyPort: null,
  };

  it('parses automatic DNS and direct proxy', () => {
    expect(parseNetworkSettings(base)).toEqual({
      secureDns: { mode: 'automatic', servers: [] },
      proxy: { mode: 'direct' },
    });
  });

  it('requires at least one server for secure DNS', () => {
    expect(() =>
      parseNetworkSettings({ ...base, secureDnsMode: 'secure', secureDnsServers: [] }),
    ).toThrow();
  });

  it('preserves DoH servers when DNS is off (config retention)', () => {
    const result = parseNetworkSettings({
      ...base,
      secureDnsMode: 'off',
      secureDnsServers: ['https://cloudflare-dns.com/dns-query'],
    });
    expect(result.secureDns).toEqual({
      mode: 'off',
      servers: ['https://cloudflare-dns.com/dns-query'],
    });
  });

  it('parses secure DNS and de-duplicates servers preserving order', () => {
    const result = parseNetworkSettings({
      ...base,
      secureDnsMode: 'secure',
      secureDnsServers: ['https://a/q', 'https://b/q', 'https://a/q'],
    });
    expect(result.secureDns).toEqual({ mode: 'secure', servers: ['https://a/q', 'https://b/q'] });
  });

  it('parses a fixed proxy with all fields', () => {
    const result = parseNetworkSettings({
      ...base,
      proxyMode: 'fixed',
      fixedProxyScheme: 'socks5',
      fixedProxyHost: '127.0.0.1',
      fixedProxyPort: 1080,
    });
    expect(result.proxy).toEqual({ mode: 'fixed', scheme: 'socks5', host: '127.0.0.1', port: 1080 });
  });

  it('rejects a fixed proxy missing fields, and unknown modes', () => {
    expect(() => parseNetworkSettings({ ...base, proxyMode: 'fixed' })).toThrow();
    expect(() =>
      parseNetworkSettings({
        ...base,
        proxyMode: 'fixed',
        fixedProxyScheme: 'ftp',
        fixedProxyHost: 'h',
        fixedProxyPort: 1,
      }),
    ).toThrow();
    expect(() => parseNetworkSettings({ ...base, secureDnsMode: 'weird' })).toThrow();
    expect(() => parseNetworkSettings({ ...base, proxyMode: 'pac' })).toThrow();
  });
});

describe('toRawNetworkSettings', () => {
  it('flattens secure DNS and fixed proxy', () => {
    expect(
      toRawNetworkSettings({
        secureDns: { mode: 'secure', servers: ['https://a/q'] },
        proxy: { mode: 'fixed', scheme: 'http', host: 'h', port: 80 },
      }),
    ).toEqual({
      secureDnsMode: 'secure',
      secureDnsServers: ['https://a/q'],
      proxyMode: 'fixed',
      fixedProxyScheme: 'http',
      fixedProxyHost: 'h',
      fixedProxyPort: 80,
    });
  });

  it('keeps servers when flattening off DNS (does not wipe saved DoH)', () => {
    const raw = toRawNetworkSettings({
      secureDns: { mode: 'off', servers: ['https://a/q'] },
      proxy: { mode: 'direct' },
    });
    expect(raw.secureDnsServers).toEqual(['https://a/q']);
    expect(raw.fixedProxyScheme).toBeNull();
    expect(raw.fixedProxyHost).toBeNull();
    expect(raw.fixedProxyPort).toBeNull();
  });
});
