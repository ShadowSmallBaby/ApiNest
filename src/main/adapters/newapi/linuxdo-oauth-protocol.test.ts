import { describe, expect, it } from 'vitest';
import {
  buildLinuxDoOAuthUrls,
  describeCallbackBody,
  extractApproveHref,
  extractSiteUserIdFromCallbackBody,
  isLinuxDoPasswordLoginUrl,
  isLinuxDoSsoBridgeUrl,
  looksLikeInteractiveAuthorizePage,
  normalizeNewApiLinuxDoCallbackUrl,
  parseOAuthStateResponse,
  parseTrustedCallbackLocation,
  parseTrustedCallbackLocationDetailed,
  resolveApproveUrl,
} from './linuxdo-oauth-protocol';

describe('linuxdo-oauth-protocol', () => {
  it('builds state and authorize URLs from site base and client id', () => {
    const urls = buildLinuxDoOAuthUrls(
      'https://newapi.example.com/prefix/',
      'client-id',
      'IzWzSM88NsI3',
    );
    expect(urls).not.toBeNull();
    expect(urls!.stateUrl).toBe('https://newapi.example.com/api/oauth/state?aff=');
    expect(urls!.authorizeUrl).toBe(
      'https://connect.linux.do/oauth2/authorize?response_type=code&client_id=client-id&state=IzWzSM88NsI3',
    );
  });

  it('refuses empty client id or state when building URLs', () => {
    expect(buildLinuxDoOAuthUrls('https://newapi.example.com', '', 's')).toBeNull();
    expect(buildLinuxDoOAuthUrls('https://newapi.example.com', 'c', '')).toBeNull();
    expect(buildLinuxDoOAuthUrls('not-a-url', 'c', 's')).toBeNull();
  });

  it('parses oauth state JSON only when success and data are valid', () => {
    expect(parseOAuthStateResponse('{"data":"IzWzSM88NsI3","message":"","success":true}')).toBe(
      'IzWzSM88NsI3',
    );
    expect(parseOAuthStateResponse('{"data":"x","success":false}')).toBeNull();
    expect(parseOAuthStateResponse('{"data":"","success":true}')).toBeNull();
    expect(parseOAuthStateResponse('not-json')).toBeNull();
  });

  it('extracts the primary approve href from authorize HTML', () => {
    const html = `
      <html><body>
        <a href="/oauth2/approve/PWHf57tYxHJPF9icGgpEJPO0ncG2BZcb" class="btn-pill btn-pill-primary">允许</a>
        <a href="/oauth2/approve/other" class="btn-pill">拒绝</a>
      </body></html>
    `;
    expect(extractApproveHref(html)).toBe('/oauth2/approve/PWHf57tYxHJPF9icGgpEJPO0ncG2BZcb');
    expect(resolveApproveUrl('/oauth2/approve/PWHf57tYxHJPF9icGgpEJPO0ncG2BZcb')).toBe(
      'https://connect.linux.do/oauth2/approve/PWHf57tYxHJPF9icGgpEJPO0ncG2BZcb',
    );
  });

  it('rejects approve hrefs outside connect.linux.do', () => {
    expect(resolveApproveUrl('https://evil.example/oauth2/approve/x')).toBeNull();
    expect(resolveApproveUrl('/login')).toBeNull();
  });

  it('accepts only trusted site callback locations with matching state', () => {
    const parsed = parseTrustedCallbackLocation(
      'https://newapi.example.com/api/oauth/linuxdo?code=UXfqQkKX01xUQJFvAahd7r9tX19DTreT&state=IzWzSM88NsI3',
      'https://newapi.example.com/prefix/',
      'IzWzSM88NsI3',
    );
    expect(parsed).toMatchObject({
      code: 'UXfqQkKX01xUQJFvAahd7r9tX19DTreT',
      state: 'IzWzSM88NsI3',
    });
    expect(parsed?.callbackUrl).toContain('/api/oauth/linuxdo');
  });

  it('rejects open redirects and state mismatch without exposing secrets in failure', () => {
    expect(
      parseTrustedCallbackLocation(
        'https://evil.example/api/oauth/linuxdo?code=abc&state=IzWzSM88NsI3',
        'https://newapi.example.com',
        'IzWzSM88NsI3',
      ),
    ).toBeNull();
    expect(
      parseTrustedCallbackLocation(
        'https://newapi.example.com/api/oauth/linuxdo?code=abc&state=other',
        'https://newapi.example.com',
        'IzWzSM88NsI3',
      ),
    ).toBeNull();
  });

  it('accepts oauth/linuxdo path variants and reports detailed reject reasons', () => {
    expect(
      parseTrustedCallbackLocation(
        'https://newapi.example.com/prefix/api/oauth/linuxdo?code=c&state=s',
        'https://newapi.example.com/prefix/',
        's',
      ),
    ).not.toBeNull();

    const detail = parseTrustedCallbackLocationDetailed(
      'https://newapi.example.com/oauth/callback?code=c&state=s',
      'https://newapi.example.com',
      's',
    );
    expect(detail.ok).toBe(false);
    if (!detail.ok) {
      expect(detail.reason).toBe('path_mismatch');
      expect(detail.detail).toContain('path=');
      expect(detail.detail).not.toContain('code=');
    }
  });

  it('flags authorize pages without approve as interactive', () => {
    expect(looksLikeInteractiveAuthorizePage('<html>请登录</html>')).toBe(true);
    expect(
      looksLikeInteractiveAuthorizePage(
        '<a href="/oauth2/approve/x" class="btn-pill btn-pill-primary">允许</a>',
      ),
    ).toBe(false);
  });

  it('treats Discourse SSO bridge as non-password login (auto-followable)', () => {
    expect(
      isLinuxDoSsoBridgeUrl(
        'https://linux.do/session/sso_provider?sig=abc&sso=def',
      ),
    ).toBe(true);
    expect(
      isLinuxDoSsoBridgeUrl(
        'https://connect.linux.do/discourse/sso_callback?sso=x&sig=y',
      ),
    ).toBe(true);
    expect(isLinuxDoPasswordLoginUrl('https://linux.do/session/sso_provider?sso=x')).toBe(false);
    expect(isLinuxDoPasswordLoginUrl('https://linux.do/login')).toBe(true);
    expect(isLinuxDoPasswordLoginUrl('https://connect.linux.do/login')).toBe(true);
  });

  it('does not treat SSO bridge URL as interactive dead-end when approve exists', () => {
    const html =
      '<a href="/oauth2/approve/x" class="btn-pill btn-pill-primary">允许</a>';
    expect(
      looksLikeInteractiveAuthorizePage(html, 'https://linux.do/session/sso_provider?sso=x'),
    ).toBe(false);
  });

  it('extracts site user id from common callback JSON shapes', () => {
    expect(extractSiteUserIdFromCallbackBody('{"success":true,"data":{"id":42}}')).toBe('42');
    expect(
      extractSiteUserIdFromCallbackBody('{"data":{"user":{"id":"7"}}}'),
    ).toBe('7');
    expect(extractSiteUserIdFromCallbackBody('{"ok":true}')).toBeNull();
  });

  it('extracts site user id from HTML/loose text', () => {
    expect(
      extractSiteUserIdFromCallbackBody(
        '<html><script>var user={"id":99,"username":"a"}</script></html>',
      ),
    ).toBe('99');
    expect(
      extractSiteUserIdFromCallbackBody(
        'localStorage.setItem("uid","12345");',
      ),
    ).toBe('12345');
  });

  it('describes callback body without leaking content', () => {
    const d = describeCallbackBody('{"success":true,"data":{"id":1}}');
    expect(d).toMatchObject({ kind: 'json', extractedId: true, jsonSuccess: true });
    expect(describeCallbackBody('<html></html>').kind).toBe('html');
  });

  it('normalizes SPA oauth callback to https API path', () => {
    expect(
      normalizeNewApiLinuxDoCallbackUrl(
        'http://7x.hk/oauth/linuxdo?code=abc&state=xyz',
        'https://7x.hk/',
      ),
    ).toBe('https://7x.hk/api/oauth/linuxdo?code=abc&state=xyz');

    expect(
      normalizeNewApiLinuxDoCallbackUrl(
        'https://7x.hk/api/oauth/linuxdo?code=abc&state=xyz',
        'https://7x.hk/',
      ),
    ).toBe('https://7x.hk/api/oauth/linuxdo?code=abc&state=xyz');
  });
});
