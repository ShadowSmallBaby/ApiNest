export interface StoredDeviceUnlockMaterial {
  wrappedDekCiphertext: Buffer;
  wrappedDekNonce: Buffer;
  encryptionVersion: number;
}

export interface SystemKeychainStore {
  isAvailable(): Promise<boolean>;
  saveDeviceUnlockMaterial(material: StoredDeviceUnlockMaterial): Promise<void>;
  loadDeviceUnlockMaterial(): Promise<StoredDeviceUnlockMaterial | null>;
  deleteDeviceUnlockMaterial(): Promise<void>;
}

export class UnsupportedSystemKeychainStore implements SystemKeychainStore {
  async isAvailable(): Promise<boolean> {
    return false;
  }

  async saveDeviceUnlockMaterial(_material: StoredDeviceUnlockMaterial): Promise<void> {
    throw new Error('System keychain is not available.');
  }

  async loadDeviceUnlockMaterial(): Promise<StoredDeviceUnlockMaterial | null> {
    return null;
  }

  async deleteDeviceUnlockMaterial(): Promise<void> {
    return;
  }
}

export function createSystemKeychainStore(): SystemKeychainStore {
  return new UnsupportedSystemKeychainStore();
}
