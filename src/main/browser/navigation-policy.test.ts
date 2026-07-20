import {
  buildAllowedHosts,
  decideNavigation,
  decidePermission,
  decideWindowOpen,
  isDownloadAllowed,
  isExternalProtocol,
} from './navigation-policy';

describe('navigation-policy', () => {
  const baseContext = { baseUrl: 'https://newapi.example.com/login' };

  describe('buildAllowedHosts', () => {
    it('includes the base url host', () => {
      expect(buildAllowedHosts(baseContext).has('newapi.example.com')).toBe(true);
    });

    it('merges oauth and redirect domains, normalizing case', () => {
      const hosts = buildAllowedHosts({
        baseUrl: 'https://newapi.example.com',
        oauthDomains: ['Connect.LinuxDo.org'],
        redirectDomains: ['callback.example.com'],
      });

      expect(hosts.has('connect.linuxdo.org')).toBe(true);
      expect(hosts.has('callback.example.com')).toBe(true);
    });

    it('only allows the base host when no extra domains are configured', () => {
      expect(buildAllowedHosts(baseContext).size).toBe(1);
    });
  });

  describe('decideNavigation', () => {
    it('allows navigation to the same host', () => {
      expect(decideNavigation('https://newapi.example.com/user', baseContext).allowed).toBe(true);
    });

    it('rejects a different host', () => {
      expect(decideNavigation('https://evil.com/phish', baseContext).allowed).toBe(false);
    });

    it('rejects a confusable host that is not an exact match', () => {
      expect(decideNavigation('https://evil-newapi.example.com', baseContext).allowed).toBe(false);
      expect(decideNavigation('https://newapi.example.com.evil.com', baseContext).allowed).toBe(false);
    });

    it('does not loosely allow subdomains of the base host', () => {
      expect(decideNavigation('https://api.newapi.example.com', baseContext).allowed).toBe(false);
    });

    it('rejects non-http(s) protocols', () => {
      expect(decideNavigation('file:///etc/passwd', baseContext).allowed).toBe(false);
      expect(decideNavigation('mailto:someone@example.com', baseContext).allowed).toBe(false);
    });

    it('rejects malformed urls', () => {
      expect(decideNavigation('not a url', baseContext).allowed).toBe(false);
    });
  });

  describe('decideWindowOpen', () => {
    it('allows window.open only when navigation would allow the same host', () => {
      expect(decideWindowOpen('https://newapi.example.com/user', baseContext).allowed).toBe(true);
      expect(
        decideWindowOpen('https://connect.linux.do/oauth2/authorize', {
          ...baseContext,
          oauthDomains: ['connect.linux.do'],
        }).allowed,
      ).toBe(true);
    });

    it('denies window.open for hosts outside the allowed set', () => {
      expect(decideWindowOpen('https://evil.example/popup', baseContext).allowed).toBe(false);
    });
  });

  describe('decidePermission', () => {
    it('denies every permission request', () => {
      for (const permission of ['media', 'geolocation', 'notifications', 'clipboard-read']) {
        expect(decidePermission(permission).allowed).toBe(false);
      }
    });
  });

  describe('isDownloadAllowed', () => {
    it('denies downloads', () => {
      expect(isDownloadAllowed()).toBe(false);
    });
  });

  describe('isExternalProtocol', () => {
    it('flags non-web protocols as external', () => {
      expect(isExternalProtocol('mailto:someone@example.com')).toBe(true);
      expect(isExternalProtocol('tel:+123456')).toBe(true);
      expect(isExternalProtocol('myapp://open')).toBe(true);
    });

    it('does not flag http(s) as external', () => {
      expect(isExternalProtocol('https://newapi.example.com')).toBe(false);
      expect(isExternalProtocol('http://newapi.example.com')).toBe(false);
    });
  });
});
