import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { runMigrations } from '../storage/run-migrations';
import { LockService } from './lock-service';
import { VaultService } from './vault-service';

describe('lock-service', () => {
  function createLockService(): { lockService: LockService; cleanup: () => void } {
    const directory = mkdtempSync(join(tmpdir(), 'apinest-lock-'));
    const filePath = join(directory, 'lock.db');
    const database = new Database(filePath);
    runMigrations(database);
    const vaultService = new VaultService(database);

    return {
      lockService: new LockService(vaultService),
      cleanup: () => {
        database.close();
        rmSync(directory, { recursive: true, force: true });
      },
    };
  }

  it('initializes on first unlock and clears dek on lock', async () => {
    const { lockService, cleanup } = createLockService();

    try {
      expect(lockService.isInitialized()).toBe(false);
      await lockService.initialize('correct horse battery staple');
      expect(lockService.isInitialized()).toBe(true);
      expect(lockService.isUnlocked()).toBe(true);

      lockService.lock();
      expect(lockService.isUnlocked()).toBe(false);
      expect(() => lockService.assertUnlocked()).toThrow('Application is locked.');
    } finally {
      cleanup();
    }
  });

  it('requires the correct password after relock', async () => {
    const { lockService, cleanup } = createLockService();

    try {
      await lockService.initialize('correct horse battery staple');
      lockService.lock();

      await expect(lockService.unlock('wrong password')).rejects.toThrow('Invalid master password.');
      await expect(lockService.unlock('correct horse battery staple')).resolves.toBeUndefined();
      expect(lockService.isUnlocked()).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('requires unlock after service recreation with the same database', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'apinest-lock-restart-'));
    const filePath = join(directory, 'lock.db');
    const database = new Database(filePath);

    try {
      runMigrations(database);
      const firstVault = new VaultService(database);
      const firstLockService = new LockService(firstVault);
      await firstLockService.initialize('correct horse battery staple');
      expect(firstLockService.isUnlocked()).toBe(true);

      const secondVault = new VaultService(database);
      const secondLockService = new LockService(secondVault);
      expect(secondLockService.isInitialized()).toBe(true);
      expect(secondLockService.isUnlocked()).toBe(false);

      await expect(secondLockService.unlock('wrong password')).rejects.toThrow('Invalid master password.');
      await expect(secondLockService.unlock('correct horse battery staple')).resolves.toBeUndefined();
      expect(secondLockService.isUnlocked()).toBe(true);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
