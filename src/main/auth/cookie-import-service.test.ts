import { describe, expect, it } from 'vitest';
import { parseCookieHeaderPairs } from './cookie-import-service';

describe('parseCookieHeaderPairs', () => {
  it('parses document.cookie style pairs', () => {
    expect(parseCookieHeaderPairs('session=abc; uid=1')).toEqual([
      { name: 'session', value: 'abc' },
      { name: 'uid', value: '1' },
    ]);
  });

  it('skips attribute-looking tokens and empties', () => {
    expect(parseCookieHeaderPairs('session=x; Path=/; Secure; foo=bar')).toEqual([
      { name: 'session', value: 'x' },
      { name: 'foo', value: 'bar' },
    ]);
  });

  it('returns empty for blank input', () => {
    expect(parseCookieHeaderPairs('   ')).toEqual([]);
  });
});
