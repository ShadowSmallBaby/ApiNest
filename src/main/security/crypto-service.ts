import argon2 from 'argon2';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const ARGON2_CONFIG = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
  hashLength: 32,
} as const;

export const ENCRYPTION_VERSION = 1;
const AES_ALGORITHM = 'aes-256-gcm';
const NONCE_LENGTH = 12;
const SALT_LENGTH = 16;
const DEK_LENGTH = 32;
const AUTH_TAG_LENGTH = 16;

export interface KdfConfig {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

export interface DerivedKeyResult {
  digest: string;
  kek: Buffer;
  salt: Buffer;
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

export interface WrappedDekResult {
  ciphertext: Buffer;
  nonce: Buffer;
}

export interface EncryptedPayload {
  ciphertext: Buffer;
  nonce: Buffer;
  encryptionVersion: number;
}

function toBuffer(value: Buffer | Uint8Array<ArrayBufferLike>): Buffer {
  return Buffer.from(value);
}

function assertEncryptionVersion(encryptionVersion: number): void {
  if (encryptionVersion !== ENCRYPTION_VERSION) {
    throw new Error(`Unsupported encryption version: ${encryptionVersion}.`);
  }
}

function splitCiphertextAndAuthTag(ciphertext: Buffer): { encrypted: Buffer; authTag: Buffer } {
  if (ciphertext.length <= AUTH_TAG_LENGTH) {
    throw new Error('Encrypted payload is invalid.');
  }

  return {
    encrypted: ciphertext.subarray(0, ciphertext.length - AUTH_TAG_LENGTH),
    authTag: ciphertext.subarray(ciphertext.length - AUTH_TAG_LENGTH),
  };
}

export async function deriveKeyFromPassword(
  password: string,
  salt = randomBytes(SALT_LENGTH),
  config: KdfConfig = ARGON2_CONFIG,
): Promise<DerivedKeyResult> {
  const digest = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: config.memoryCost,
    timeCost: config.timeCost,
    parallelism: config.parallelism,
    hashLength: ARGON2_CONFIG.hashLength,
    salt,
  });

  const raw = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: config.memoryCost,
    timeCost: config.timeCost,
    parallelism: config.parallelism,
    hashLength: ARGON2_CONFIG.hashLength,
    salt,
    raw: true,
  });

  return {
    digest,
    kek: toBuffer(raw),
    salt,
    memoryCost: config.memoryCost,
    timeCost: config.timeCost,
    parallelism: config.parallelism,
  };
}

export async function verifyPasswordDigest(password: string, digest: string): Promise<boolean> {
  return argon2.verify(digest, password);
}

export function generateDek(): Buffer {
  return randomBytes(DEK_LENGTH);
}

export function wrapDek(dek: Buffer, kek: Buffer): WrappedDekResult {
  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = createCipheriv(AES_ALGORITHM, kek, nonce);
  const encrypted = Buffer.concat([cipher.update(dek), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: Buffer.concat([encrypted, authTag]),
    nonce,
  };
}

export function unwrapDek(wrapped: WrappedDekResult, kek: Buffer): Buffer {
  const { encrypted, authTag } = splitCiphertextAndAuthTag(wrapped.ciphertext);
  const decipher = createDecipheriv(AES_ALGORITHM, kek, wrapped.nonce);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

export function encryptPayload(plaintext: Buffer, dek: Buffer): EncryptedPayload {
  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = createCipheriv(AES_ALGORITHM, dek, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: Buffer.concat([encrypted, authTag]),
    nonce,
    encryptionVersion: ENCRYPTION_VERSION,
  };
}

export function decryptPayload(payload: EncryptedPayload, dek: Buffer): Buffer {
  assertEncryptionVersion(payload.encryptionVersion);
  const { encrypted, authTag } = splitCiphertextAndAuthTag(payload.ciphertext);
  const decipher = createDecipheriv(AES_ALGORITHM, dek, payload.nonce);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}
