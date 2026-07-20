import type Database from 'better-sqlite3';
import {
  AppLockConfigRepository,
} from '../storage/repositories/app-lock-config-repository';
import {
  SecretRepository,
} from '../storage/repositories/secret-repository';
import {
  decryptPayload,
  deriveKeyFromPassword,
  encryptPayload,
  ENCRYPTION_VERSION,
  generateDek,
  unwrapDek,
  verifyPasswordDigest,
  wrapDek,
} from './crypto-service';

export class VaultService {
  private dek: Buffer | null = null;

  private readonly appLockConfigRepository: AppLockConfigRepository;
  private readonly secretRepository: SecretRepository;

  constructor(database: Database.Database) {
    this.appLockConfigRepository = new AppLockConfigRepository(database);
    this.secretRepository = new SecretRepository(database);
  }

  isInitialized(): boolean {
    return this.appLockConfigRepository.get() !== null;
  }

  isUnlocked(): boolean {
    return this.dek !== null;
  }

  async initialize(masterPassword: string): Promise<void> {
    if (this.isInitialized()) {
      throw new Error('Vault is already initialized.');
    }

    const derived = await deriveKeyFromPassword(masterPassword);
    const dek = generateDek();
    const wrappedDek = wrapDek(dek, derived.kek);
    const now = new Date().toISOString();

    this.appLockConfigRepository.upsert({
      id: 'default',
      passwordDigest: derived.digest,
      kdfSalt: derived.salt,
      kdfMemoryCost: derived.memoryCost,
      kdfTimeCost: derived.timeCost,
      kdfParallelism: derived.parallelism,
      wrappedDekCiphertext: wrappedDek.ciphertext,
      wrappedDekNonce: wrappedDek.nonce,
      encryptionVersion: ENCRYPTION_VERSION,
      createdAt: now,
      updatedAt: now,
    });

    this.dek = dek;
  }

  async unlock(masterPassword: string): Promise<void> {
    const config = this.appLockConfigRepository.get();

    if (!config) {
      throw new Error('Vault has not been initialized.');
    }

    const matches = await verifyPasswordDigest(masterPassword, config.passwordDigest);
    if (!matches) {
      throw new Error('Invalid master password.');
    }

    if (config.encryptionVersion !== ENCRYPTION_VERSION) {
      throw new Error(`Unsupported vault encryption version: ${config.encryptionVersion}.`);
    }

    const derived = await deriveKeyFromPassword(masterPassword, Buffer.from(config.kdfSalt), {
      memoryCost: config.kdfMemoryCost,
      timeCost: config.kdfTimeCost,
      parallelism: config.kdfParallelism,
    });
    this.dek = unwrapDek(
      {
        ciphertext: config.wrappedDekCiphertext,
        nonce: config.wrappedDekNonce,
      },
      derived.kek,
    );
  }

  lock(): void {
    this.dek = null;
  }

  storeSecret(secretId: string, accountId: string, purpose: string, plaintext: string): void {
    if (!this.dek) {
      throw new Error('Vault is locked.');
    }

    const encrypted = encryptPayload(Buffer.from(plaintext, 'utf8'), this.dek);
    const now = new Date().toISOString();

    this.secretRepository.upsert({
      secretId,
      accountId,
      purpose,
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      encryptionVersion: encrypted.encryptionVersion,
      createdAt: now,
      updatedAt: now,
    });
  }

  readSecret(secretId: string): string | null {
    if (!this.dek) {
      throw new Error('Vault is locked.');
    }

    const entity = this.secretRepository.get(secretId);
    if (!entity) {
      return null;
    }

    return decryptPayload(
      {
        ciphertext: entity.ciphertext,
        nonce: entity.nonce,
        encryptionVersion: entity.encryptionVersion,
      },
      this.dek,
    ).toString('utf8');
  }

  /** 是否存在指定 secret（仅布尔存在性；不要求解锁，因为不接触明文）。 */
  hasSecret(secretId: string): boolean {
    return this.secretRepository.exists(secretId);
  }

  /** 删除指定 secret（清除凭据引用；不要求解锁，因为不接触明文）。 */
  deleteSecret(secretId: string): void {
    this.secretRepository.delete(secretId);
  }
}
