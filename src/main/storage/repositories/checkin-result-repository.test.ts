import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runMigrations } from '../run-migrations';
import { CheckInResultRepository } from './checkin-result-repository';

describe('CheckInResultRepository', () => {
  it('keeps results isolated by account and returns newest first', () => {
    const directory = mkdtempSync(join(tmpdir(), 'apinest-checkin-'));
    const database = new Database(join(directory, 'test.db'));

    try {
      runMigrations(database);
      database.pragma('foreign_keys = ON');
      database.prepare(
        `INSERT INTO sites (
          id, name, platform, base_url, route_profile, record_version, created_at, updated_at
        ) VALUES ('site-a', 'Site A', 'newapi', 'https://example.com', 'modern', 1, ?, ?)`,
      ).run('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      database.prepare(
        `INSERT INTO accounts (
          id, platform, base_url, display_name, site_id, record_version, created_at, updated_at
        ) VALUES (?, 'newapi', 'https://example.com', ?, 'site-a', 1, ?, ?)`,
      ).run('account-a', 'Account A', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      database.prepare(
        `INSERT INTO accounts (
          id, platform, base_url, display_name, site_id, record_version, created_at, updated_at
        ) VALUES (?, 'newapi', 'https://example.com', ?, 'site-a', 1, ?, ?)`,
      ).run('account-b', 'Account B', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      database.prepare(
        `INSERT INTO operations (
          id, account_id, kind, status, started_at
        ) VALUES (?, ?, 'checkin', 'success', ?), (?, ?, 'checkin', 'success', ?), (?, ?, 'checkin', 'error', ?)`,
      ).run(
        'first', 'account-a', '2026-01-01T00:00:00.000Z',
        'second', 'account-a', '2026-01-02T00:00:00.000Z',
        'other', 'account-b', '2026-01-03T00:00:00.000Z',
      );
      const repository = new CheckInResultRepository(database);
      repository.record({
        operationId: 'first',
        accountId: 'account-a',
        result: 'success',
        message: 'Check-in completed.',
        checkedAt: '2026-01-01T00:00:00.000Z',
      });
      repository.record({
        operationId: 'second',
        accountId: 'account-a',
        result: 'already_checked_in',
        message: 'Already checked in.',
        checkedAt: '2026-01-02T00:00:00.000Z',
      });
      repository.record({
        operationId: 'other',
        accountId: 'account-b',
        result: 'failed',
        message: 'Check-in request failed.',
        checkedAt: '2026-01-03T00:00:00.000Z',
      });

      expect(repository.listRecent('account-a')).toEqual([
        expect.objectContaining({ operationId: 'second', result: 'already_checked_in' }),
        expect.objectContaining({ operationId: 'first', result: 'success' }),
      ]);
      expect(repository.listRecent('account-b')).toEqual([
        expect.objectContaining({ operationId: 'other', result: 'failed' }),
      ]);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
