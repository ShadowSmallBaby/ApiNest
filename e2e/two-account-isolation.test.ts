import { describe, expect, it } from 'vitest';
import { AppError } from '../src/shared/ipc/errors';
import { AccountService } from '../src/main/accounts/account-service';
import { getAccountPartition } from '../src/main/auth/account-partition';

const accountA = '11111111-1111-4111-8111-111111111111';
const accountB = '22222222-2222-4222-8222-222222222222';

describe('双账户会话隔离场景', () => {
  it('相同 URL 的 A/B 永远使用不同的持久 partition，重启后派生值不变', () => {
    const firstStartA = getAccountPartition(accountA);
    const firstStartB = getAccountPartition(accountB);
    const restartedA = getAccountPartition(accountA);

    expect(firstStartA).toBe('persist:apinest-account-11111111-1111-4111-8111-111111111111');
    expect(firstStartB).toBe('persist:apinest-account-22222222-2222-4222-8222-222222222222');
    expect(firstStartA).not.toBe(firstStartB);
    expect(restartedA).toBe(firstStartA);
  });

  it('删除 A 只清理 A 的 session 且不影响同 URL 的 B 账户', async () => {
    const records = new Map([
      [accountA, {
        id: accountA, platform: 'newapi', baseUrl: 'https://same.example.com', displayName: 'A',
        recordVersion: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      }],
      [accountB, {
        id: accountB, platform: 'newapi', baseUrl: 'https://same.example.com', displayName: 'B',
        recordVersion: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      }],
    ]);
    const cleared: string[] = [];
    const service = new AccountService({
      create: () => {},
      list: () => Array.from(records.values()),
      get: id => records.get(id) ?? null,
      update: () => {},
      delete: id => { records.delete(id); },
    }, {
      sessionCleaner: { clearAccountSession: async id => { cleared.push(id); } },
    });

    await service.remove(accountA);

    expect(cleared).toEqual([accountA]);
    expect(records.has(accountA)).toBe(false);
    expect(records.get(accountB)).toMatchObject({ baseUrl: 'https://same.example.com', displayName: 'B' });
    await expect(service.clearSession(accountA)).rejects.toThrow(
      new AppError('ACCOUNT_NOT_FOUND', 'Account was not found.'),
    );
  });
});
