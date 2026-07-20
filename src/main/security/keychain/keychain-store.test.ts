import { UnsupportedSystemKeychainStore } from './keychain-store';

describe('UnsupportedSystemKeychainStore', () => {
  it('keeps the main password path independent from system keychain availability', async () => {
    const store = new UnsupportedSystemKeychainStore();

    await expect(store.isAvailable()).resolves.toBe(false);
    await expect(store.loadDeviceUnlockMaterial()).resolves.toBeNull();
    await expect(store.deleteDeviceUnlockMaterial()).resolves.toBeUndefined();
    await expect(
      store.saveDeviceUnlockMaterial({
        wrappedDekCiphertext: Buffer.from('ciphertext'),
        wrappedDekNonce: Buffer.from('nonce'),
        encryptionVersion: 1,
      }),
    ).rejects.toThrow('System keychain is not available.');
  });
});
