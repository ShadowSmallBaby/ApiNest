import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { runMigrations } from '../storage/run-migrations';
import { AccountRepository } from '../storage/repositories/account-repository';
import { AccountAuthStateRepository } from '../storage/repositories/account-auth-state-repository';
import type { AccountSessionCleaner } from '../auth/session-service';
import { AccountService } from './account-service';

describe('AccountService', () => {
  function createService(sessionCleaner?: AccountSessionCleaner): {
    service: AccountService;
    database: Database.Database;
    cleanup: () => void;
  } {
    const directory = mkdtempSync(join(tmpdir(), 'apinest-accounts-'));
    const filePath = join(directory, 'accounts.db');
    const database = new Database(filePath);
    runMigrations(database);

    return {
      service: new AccountService(new AccountRepository(database), { sessionCleaner }),
      database,
      cleanup: () => {
        database.close();
        rmSync(directory, { recursive: true, force: true });
      },
    };
  }

  function createRecordingCleaner(): { cleaner: AccountSessionCleaner; clearedIds: string[] } {
    const clearedIds: string[] = [];
    return {
      clearedIds,
      cleaner: {
        clearAccountSession: async (accountId: string) => {
          clearedIds.push(accountId);
        },
      },
    };
  }

  it('creates duplicate normalized urls as separate accounts', () => {
    const { service, cleanup } = createService();

    try {
      const first = service.create({
        platform: 'newapi',
        baseUrl: 'HTTPS://Example.COM',
        displayName: 'Account A',
      });
      const second = service.create({
        platform: 'newapi',
        baseUrl: 'https://example.com/',
        displayName: 'Account B',
      });

      expect(first.id).not.toBe(second.id);
      expect(first.baseUrl).toBe('https://example.com');
      expect(second.baseUrl).toBe('https://example.com');
      expect(service.list()).toHaveLength(2);
    } finally {
      cleanup();
    }
  });

  it('updates one account without changing another account with the same url', () => {
    const { service, cleanup } = createService();

    try {
      const first = service.create({
        platform: 'newapi',
        baseUrl: 'https://example.com',
        displayName: 'Account A',
      });
      const second = service.create({
        platform: 'newapi',
        baseUrl: 'https://example.com',
        displayName: 'Account B',
      });

      const updated = service.update(first.id, { displayName: 'Account A Updated' });
      const accounts = service.list();

      expect(updated.id).toBe(first.id);
      expect(accounts.find(account => account.id === first.id)?.displayName).toBe('Account A Updated');
      expect(accounts.find(account => account.id === second.id)?.displayName).toBe('Account B');
    } finally {
      cleanup();
    }
  });

  it('copies only account metadata into a new unknown-auth account', () => {
    const { service, database, cleanup } = createService();

    try {
      const source = service.create({
        platform: 'newapi',
        baseUrl: 'https://example.com/path?b=2&a=1#frag',
        displayName: 'Account A',
        note: 'note',
        linuxDoClientId: 'client-id',
      });

      const copied = service.copy(source.id);
      const secretRows = database.prepare('SELECT * FROM secrets').all();

      expect(copied.id).not.toBe(source.id);
      expect(copied.baseUrl).toBe('https://example.com/path?b=2&a=1');
      expect(copied.note).toBe('note');
      expect(copied.linuxDoClientId).toBe('client-id');
      expect(copied.authState).toBe('unknown');
      expect(secretRows).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  it('deletes only the selected account id', async () => {
    const { service, cleanup } = createService();

    try {
      const first = service.create({
        platform: 'newapi',
        baseUrl: 'https://example.com',
        displayName: 'Account A',
      });
      const second = service.create({
        platform: 'newapi',
        baseUrl: 'https://example.com',
        displayName: 'Account B',
      });

      await service.remove(first.id);
      const accounts = service.list();

      expect(accounts).toHaveLength(1);
      expect(accounts[0].id).toBe(second.id);
    } finally {
      cleanup();
    }
  });

  it('rejects operations for missing accounts', async () => {
    const { service, cleanup } = createService();

    try {
      expect(() => service.update('11111111-1111-4111-8111-111111111111', { displayName: 'Missing' })).toThrow(
        'Account was not found.',
      );
      expect(() => service.copy('11111111-1111-4111-8111-111111111111')).toThrow('Account was not found.');
      await expect(service.remove('11111111-1111-4111-8111-111111111111')).rejects.toThrow(
        'Account was not found.',
      );
      await expect(service.clearSession('11111111-1111-4111-8111-111111111111')).rejects.toThrow(
        'Account was not found.',
      );
    } finally {
      cleanup();
    }
  });

  it('clears only the removed account session and keeps other accounts intact', async () => {
    const { cleaner, clearedIds } = createRecordingCleaner();
    const { service, cleanup } = createService(cleaner);

    try {
      const first = service.create({
        platform: 'newapi',
        baseUrl: 'https://example.com',
        displayName: 'Account A',
      });
      const second = service.create({
        platform: 'newapi',
        baseUrl: 'https://example.com',
        displayName: 'Account B',
      });

      await service.remove(first.id);

      expect(clearedIds).toEqual([first.id]);
      const accounts = service.list();
      expect(accounts).toHaveLength(1);
      expect(accounts[0].id).toBe(second.id);
    } finally {
      cleanup();
    }
  });

  it('clears one account session without deleting its record or touching others', async () => {
    const { cleaner, clearedIds } = createRecordingCleaner();
    const { service, cleanup } = createService(cleaner);

    try {
      const first = service.create({
        platform: 'newapi',
        baseUrl: 'https://example.com',
        displayName: 'Account A',
      });
      const second = service.create({
        platform: 'newapi',
        baseUrl: 'https://example.com',
        displayName: 'Account B',
      });

      await service.clearSession(first.id);

      expect(clearedIds).toEqual([first.id]);
      const accounts = service.list();
      expect(accounts.map(account => account.id).sort()).toEqual([first.id, second.id].sort());
    } finally {
      cleanup();
    }
  });

  it('reflects persisted auth state in list, falling back to unknown', () => {
    const directory = mkdtempSync(join(tmpdir(), 'apinest-accounts-authstate-'));
    const filePath = join(directory, 'accounts.db');
    const database = new Database(filePath);
    runMigrations(database);

    try {
      const accountRepository = new AccountRepository(database);
      const authStateRepository = new AccountAuthStateRepository(database);
      const service = new AccountService(accountRepository, { authStateRepository });

      const first = service.create({
        platform: 'newapi',
        baseUrl: 'https://example.com',
        displayName: 'Account A',
      });
      const second = service.create({
        platform: 'newapi',
        baseUrl: 'https://example.com',
        displayName: 'Account B',
      });

      authStateRepository.upsert({ accountId: first.id, state: 'active', lastVerifiedAt: '2026-07-13T00:00:00.000Z' });

      const accounts = service.list();
      expect(accounts.find(account => account.id === first.id)?.authState).toBe('active');
      expect(accounts.find(account => account.id === second.id)?.authState).toBe('unknown');
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
