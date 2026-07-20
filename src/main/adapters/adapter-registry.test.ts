import { AppError } from '../../shared/ipc/errors';
import { AdapterRegistry } from './adapter-registry';

describe('AdapterRegistry', () => {
  it('provides the NewAPI adapter with embedded login and check-in capabilities', async () => {
    const registry = new AdapterRegistry();
    const adapter = registry.get('newapi');

    expect(adapter.platform).toBe('newapi');

    const capabilities = await adapter.getCapabilities({
      id: '11111111-1111-4111-8111-111111111111',
      platform: 'newapi',
      baseUrl: 'https://newapi.example.com',
      displayName: 'Account A',
    });

    expect(capabilities.embeddedLogin).toBe(true);
    expect(capabilities.checkIn).toBe(true);
    expect(capabilities.pages.login).toBe(true);
  });

  it('enables linuxDoOAuth only when a client id is present', async () => {
    const adapter = new AdapterRegistry().get('newapi');

    const without = await adapter.getCapabilities({
      id: '11111111-1111-4111-8111-111111111111',
      platform: 'newapi',
      baseUrl: 'https://newapi.example.com',
      displayName: 'Account A',
    });
    const withClientId = await adapter.getCapabilities({
      id: '22222222-2222-4222-8222-222222222222',
      platform: 'newapi',
      baseUrl: 'https://newapi.example.com',
      displayName: 'Account B',
      linuxDoClientId: 'client-id',
    });

    expect(without.linuxDoOAuth).toBe(false);
    expect(withClientId.linuxDoOAuth).toBe(true);
  });

  it('resolves known NewAPI page urls against the account base url', () => {
    const adapter = new AdapterRegistry().get('newapi');
    const account = {
      id: '11111111-1111-4111-8111-111111111111',
      platform: 'newapi' as const,
      baseUrl: 'https://newapi.example.com',
      displayName: 'Account A',
    };

    expect(adapter.getPageUrl(account, 'login')?.toString()).toBe('https://newapi.example.com/sign-in');
    expect(adapter.getPageUrl(account, 'userCenter')?.toString()).toBe('https://newapi.example.com/profile');
  });

  it('registers Sub2API and CPA as unsupported placeholders with no capabilities', async () => {
    const registry = new AdapterRegistry();

    for (const platform of ['sub2api', 'cliproxyapi'] as const) {
      const adapter = registry.get(platform);
      const account = {
        id: '11111111-1111-4111-8111-111111111111',
        platform,
        baseUrl: 'https://example.com',
        displayName: 'Account',
      };

      const capabilities = await adapter.getCapabilities(account);
      expect(capabilities.embeddedLogin).toBe(false);
      expect(capabilities.checkIn).toBe(false);
      expect(capabilities.pages).toEqual({});
      expect(adapter.getPageUrl(account, 'home')).toBeNull();
      await expect(adapter.validateSession({
        accountId: account.id,
        baseUrl: account.baseUrl,
        platform,
        partition: 'persist:apinest-account-11111111-1111-4111-8111-111111111111',
      })).resolves.toBe('unknown');

      const detection = await adapter.detect('https://example.com');
      expect(detection.confidence).toBe('unknown');
    }
  });

  it('reports registered platforms and rejects unknown ones', () => {
    const registry = new AdapterRegistry();

    expect(registry.has('newapi')).toBe(true);
    expect(() => registry.get('mystery' as never)).toThrow(AppError);
  });
});
