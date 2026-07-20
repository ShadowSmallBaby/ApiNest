import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { runMigrations } from '../storage/run-migrations';
import { AccountRepository } from '../storage/repositories/account-repository';
import { VaultService } from './vault-service';
import {
  decryptPayload,
  deriveKeyFromPassword,
  encryptPayload,
  ENCRYPTION_VERSION,
  generateDek,
  unwrapDek,
  wrapDek,
} from './crypto-service';

describe('crypto-service', () => {
  it('uses different nonces for different payload encryptions', () => {
    const dek = generateDek();
    const first = encryptPayload(Buffer.from('alpha', 'utf8'), dek);
    const second = encryptPayload(Buffer.from('beta', 'utf8'), dek);

    expect(first.nonce.equals(second.nonce)).toBe(false);
    expect(decryptPayload(first, dek).toString('utf8')).toBe('alpha');
    expect(decryptPayload(second, dek).toString('utf8')).toBe('beta');
  });

  it('wraps and unwraps dek with derived kek', async () => {
    const derived = await deriveKeyFromPassword('correct horse battery staple');
    const dek = generateDek();
    const wrapped = wrapDek(dek, derived.kek);

    expect(unwrapDek(wrapped, derived.kek).equals(dek)).toBe(true);
  });

  it('rejects unsupported encrypted payload versions', () => {
    const dek = generateDek();
    const encrypted = encryptPayload(Buffer.from('alpha', 'utf8'), dek);

    expect(() => decryptPayload({ ...encrypted, encryptionVersion: ENCRYPTION_VERSION + 1 }, dek)).toThrow(
      'Unsupported encryption version',
    );
  });
});

describe('vault-service', () => {
  function createDatabase(): { database: Database.Database; cleanup: () => void } {
    const directory = mkdtempSync(join(tmpdir(), 'apinest-vault-'));
    const filePath = join(directory, 'vault.db');
    const database = new Database(filePath);
    runMigrations(database);

    return {
      database,
      cleanup: () => {
        database.close();
        rmSync(directory, { recursive: true, force: true });
      },
    };
  }

  it('initializes, locks, unlocks and reads secrets without persisting plaintext', async () => {
    const { database, cleanup } = createDatabase();

    try {
      const repository = new AccountRepository(database);
      const now = new Date().toISOString();
      repository.create({
        id: '11111111-1111-4111-8111-111111111111',
        platform: 'newapi',
        baseUrl: 'https://example.com',
        displayName: 'Account A',
        recordVersion: 1,
        createdAt: now,
        updatedAt: now,
      });

      const vault = new VaultService(database);
      await vault.initialize('correct horse battery staple');

      vault.storeSecret('secret-1', '11111111-1111-4111-8111-111111111111', 'oauth', 'plain-token');
      expect(vault.readSecret('secret-1')).toBe('plain-token');

      const secretRow = database
        .prepare('SELECT ciphertext, nonce, encryption_version FROM secrets WHERE secret_id = ?')
        .get('secret-1') as { ciphertext: Buffer; nonce: Buffer; encryption_version: number };

      expect(secretRow.ciphertext.toString('utf8')).not.toContain('plain-token');
      expect(secretRow.nonce.length).toBeGreaterThan(0);
      expect(secretRow.encryption_version).toBe(ENCRYPTION_VERSION);

      vault.lock();
      expect(vault.isUnlocked()).toBe(false);

      await expect(vault.unlock('wrong password')).rejects.toThrow('Invalid master password.');
      await vault.unlock('correct horse battery staple');
      expect(vault.readSecret('secret-1')).toBe('plain-token');
    } finally {
      cleanup();
    }
  });

  it('uses different nonces when replacing the same secret', async () => {
    const { database, cleanup } = createDatabase();

    try {
      const repository = new AccountRepository(database);
      const now = new Date().toISOString();
      repository.create({
        id: '22222222-2222-4222-8222-222222222222',
        platform: 'newapi',
        baseUrl: 'https://example.com',
        displayName: 'Account B',
        recordVersion: 1,
        createdAt: now,
        updatedAt: now,
      });

      const vault = new VaultService(database);
      await vault.initialize('correct horse battery staple');

      vault.storeSecret('secret-2', '22222222-2222-4222-8222-222222222222', 'oauth', 'first-token');
      const firstRow = database
        .prepare('SELECT ciphertext, nonce FROM secrets WHERE secret_id = ?')
        .get('secret-2') as { ciphertext: Buffer; nonce: Buffer };

      vault.storeSecret('secret-2', '22222222-2222-4222-8222-222222222222', 'oauth', 'second-token');
      const secondRow = database
        .prepare('SELECT ciphertext, nonce FROM secrets WHERE secret_id = ?')
        .get('secret-2') as { ciphertext: Buffer; nonce: Buffer };

      expect(firstRow.nonce.equals(secondRow.nonce)).toBe(false);
      expect(firstRow.ciphertext.equals(secondRow.ciphertext)).toBe(false);
      expect(vault.readSecret('secret-2')).toBe('second-token');
    } finally {
      cleanup();
    }
  });
});
