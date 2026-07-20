import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MANUAL_OAUTH_DOMAINS,
  hostsForAuthKind,
  isIdpCookieDomainAllowed,
} from './idp-hosts';

describe('idp-hosts', () => {
  it('exposes manual oauth domains for github and linuxdo connect', () => {
    expect(DEFAULT_MANUAL_OAUTH_DOMAINS).toEqual(['github.com', 'connect.linux.do']);
  });

  it('maps auth kinds to cookie-sync host allowlists', () => {
    expect(hostsForAuthKind('github')).toEqual(['github.com']);
    expect(hostsForAuthKind('linuxdo')).toEqual(['connect.linux.do', 'linux.do']);
  });

  it('accepts exact and leading-dot domains, rejects confusable hosts', () => {
    const github = hostsForAuthKind('github');
    expect(isIdpCookieDomainAllowed('github.com', github)).toBe(true);
    expect(isIdpCookieDomainAllowed('.github.com', github)).toBe(true);
    expect(isIdpCookieDomainAllowed('gist.github.com', github)).toBe(true);
    expect(isIdpCookieDomainAllowed('evilgithub.com', github)).toBe(false);
    expect(isIdpCookieDomainAllowed('github.com.evil.com', github)).toBe(false);
    expect(isIdpCookieDomainAllowed('newapi.example.com', github)).toBe(false);
  });
});
