import { describe, expect, it } from 'vitest';
import {
  buildGitHubOAuthUrls,
  extractGitHubAuthorizeForm,
  isGitHubOAuthConsentPage,
  isGitHubPasswordLoginUrl,
  normalizeNewApiGitHubCallbackUrl,
  parseGitHubOAuthStateResponse,
  parseTrustedGitHubCallbackLocation,
  parseTrustedGitHubCallbackLocationDetailed,
} from './github-oauth-protocol';

describe('github-oauth-protocol', () => {
  it('builds state and authorize URLs from site base and client id', () => {
    const urls = buildGitHubOAuthUrls(
      'https://newapi.example.com/prefix/',
      'Ov23liSY8rJTAtGTQzbJ',
      'GH6XzToQHQmi',
    );
    expect(urls).not.toBeNull();
    expect(urls!.stateUrl).toBe('https://newapi.example.com/api/oauth/state?aff=');
    expect(urls!.authorizeUrl).toBe(
      'https://github.com/login/oauth/authorize?client_id=Ov23liSY8rJTAtGTQzbJ&state=GH6XzToQHQmi&scope=user%3Aemail',
    );
  });

  it('refuses empty client id or state when building URLs', () => {
    expect(buildGitHubOAuthUrls('https://newapi.example.com', '', 's')).toBeNull();
    expect(buildGitHubOAuthUrls('https://newapi.example.com', 'c', '')).toBeNull();
    expect(buildGitHubOAuthUrls('not-a-url', 'c', 's')).toBeNull();
  });

  it('parses oauth state JSON only when success and data are valid', () => {
    expect(parseGitHubOAuthStateResponse('{"data":"GH6XzToQHQmi","message":"","success":true}')).toBe(
      'GH6XzToQHQmi',
    );
    expect(parseGitHubOAuthStateResponse('{"data":"x","success":false}')).toBeNull();
    expect(parseGitHubOAuthStateResponse('{"data":"","success":true}')).toBeNull();
    expect(parseGitHubOAuthStateResponse('not-json')).toBeNull();
  });

  it('accepts site /oauth/github callback with matching state', () => {
    const parsed = parseTrustedGitHubCallbackLocation(
      'https://newapi.example.com/oauth/github?code=f831e39c6ed5712e2791&state=GH6XzToQHQmi',
      'https://newapi.example.com/',
      'GH6XzToQHQmi',
    );
    expect(parsed).toMatchObject({
      code: 'f831e39c6ed5712e2791',
      state: 'GH6XzToQHQmi',
    });
    expect(parsed?.callbackUrl).toContain('/oauth/github');
  });

  it('accepts /api/oauth/github path as well', () => {
    const parsed = parseTrustedGitHubCallbackLocation(
      'https://newapi.example.com/api/oauth/github?code=abc&state=GH6XzToQHQmi',
      'https://newapi.example.com/',
      'GH6XzToQHQmi',
    );
    expect(parsed?.callbackUrl).toContain('/api/oauth/github');
  });

  it('rejects open redirects and state mismatch', () => {
    expect(
      parseTrustedGitHubCallbackLocation(
        'https://evil.example/oauth/github?code=abc&state=GH6XzToQHQmi',
        'https://newapi.example.com/',
        'GH6XzToQHQmi',
      ),
    ).toBeNull();

    const detailed = parseTrustedGitHubCallbackLocationDetailed(
      'https://newapi.example.com/oauth/github?code=abc&state=wrong',
      'https://newapi.example.com/',
      'GH6XzToQHQmi',
    );
    expect(detailed.ok).toBe(false);
    if (!detailed.ok) {
      expect(detailed.reason).toBe('state_mismatch');
      expect(detailed.detail).not.toContain('abc');
      expect(detailed.detail).not.toContain('wrong');
    }
  });

  it('normalizes callback to site origin and optional api path', () => {
    expect(
      normalizeNewApiGitHubCallbackUrl(
        'http://newapi.example.com/oauth/github?code=x&state=y',
        'https://newapi.example.com/',
        false,
      ),
    ).toBe('https://newapi.example.com/oauth/github?code=x&state=y');

    expect(
      normalizeNewApiGitHubCallbackUrl(
        'http://newapi.example.com/oauth/github?code=x&state=y',
        'https://newapi.example.com/',
        true,
      ),
    ).toBe('https://newapi.example.com/api/oauth/github?code=x&state=y');
  });

  it('detects GitHub password/login pages but not authorize', () => {
    expect(isGitHubPasswordLoginUrl('https://github.com/login')).toBe(true);
    expect(isGitHubPasswordLoginUrl('https://github.com/login/oauth/authorize?client_id=x')).toBe(false);
    expect(isGitHubPasswordLoginUrl('https://github.com/sessions/two-factor/app')).toBe(true);
  });

  it('detects GitHub OAuth consent / reauthorization pages', () => {
    expect(isGitHubOAuthConsentPage('https://github.com/login/oauth/authorize?client_id=x&state=y')).toBe(true);
    expect(isGitHubOAuthConsentPage('https://github.com/login')).toBe(false);
  });

  it('extracts authorize form fields from GitHub consent HTML', () => {
    const html = `
      <form action="/login/oauth/authorize" method="post">
        <input type="hidden" name="authenticity_token" value="tok" />
        <input type="hidden" name="client_id" value="Ov23li" />
        <input type="hidden" name="state" value="abc" />
        <button type="submit" name="authorize" value="1">Authorize MapleLeaf2007</button>
      </form>
    `;
    const form = extractGitHubAuthorizeForm(html);
    expect(form).not.toBeNull();
    expect(form!.action).toBe('https://github.com/login/oauth/authorize');
    expect(form!.method).toBe('POST');
    expect(form!.fields.client_id).toBe('Ov23li');
    expect(form!.fields.state).toBe('abc');
    expect(form!.fields.authorize).toBe('1');
  });
});
