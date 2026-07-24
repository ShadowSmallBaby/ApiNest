import { normalizeBaseUrl } from './url-normalization';

describe('normalizeBaseUrl', () => {
  it('normalizes protocol, host and root pathname', () => {
    expect(normalizeBaseUrl('HTTPS://Example.COM')).toBe('https://example.com');
  });

  it('removes fragments without reordering query parameters', () => {
    expect(normalizeBaseUrl('https://example.com:443/path?b=2&a=1#frag')).toBe(
      'https://example.com/path?b=2&a=1',
    );
  });

  it('keeps non-root trailing slashes and path casing intact', () => {
    expect(normalizeBaseUrl('https://Example.com/Api/V1/')).toBe('https://example.com/Api/V1/');
  });

  it('rejects unsupported protocols', () => {
    expect(() => normalizeBaseUrl('ftp://example.com')).toThrow('Only HTTP and HTTPS URLs are supported.');
  });
});
