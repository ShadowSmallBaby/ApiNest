import { describe, expect, it } from 'vitest';
import { AppError } from '../../shared/ipc/errors';
import type { CheckInResult } from '../../shared/ipc/bridge';
import type { OperationEntity } from '../storage/repositories/operation-repository';
import type { StoredCheckInResult } from '../storage/repositories/checkin-result-repository';
import { CheckInService } from './checkin-service';

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const account = {
  id: ACCOUNT_ID,
  platform: 'newapi' as const,
  baseUrl: 'https://newapi.example.com',
  displayName: 'Account A',
  recordVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function createService(result: CheckInResult, accountExists = true) {
  const operations: OperationEntity[] = [];
  const storedResults: StoredCheckInResult[] = [];
  const opened: Array<{ startUrl: string }> = [];
  let calls = 0;
  const service = new CheckInService({
    accountRepository: {
      get: () => (accountExists ? account : null),
    },
    authStateRepository: {
      getSiteUserId: () => '42',
    },
    adapterRegistry: {
      get: () => ({
        checkIn: async () => {
          calls += 1;
          return result;
        },
        getPageUrl: () => new URL('https://newapi.example.com/profile'),
      } as never),
    },
    operationRepository: {
      record: operation => operations.push(operation),
    },
    checkInResultRepository: {
      record: stored => storedResults.push(stored),
    },
    browserContainer: {
      open: async request => {
        opened.push({ startUrl: request.startUrl });
        return {} as never;
      },
    },
    now: () => '2026-01-02T00:00:00.000Z',
  });

  return { calls: () => calls, opened, operations, service, storedResults };
}

describe('CheckInService', () => {
  it('runs one account in its own partition and records a successful result', async () => {
    const test = createService({ accountId: ACCOUNT_ID, result: 'success', message: 'Check-in completed.' });

    await expect(test.service.run(ACCOUNT_ID)).resolves.toMatchObject({ result: 'success' });

    expect(test.calls()).toBe(1);
    expect(test.operations).toHaveLength(1);
    expect(test.operations[0]).toMatchObject({ accountId: ACCOUNT_ID, kind: 'checkin', status: 'success' });
    expect(test.storedResults[0]).toMatchObject({ accountId: ACCOUNT_ID, result: 'success' });
  });

  it('records a failure without turning it into success', async () => {
    const test = createService({ accountId: ACCOUNT_ID, result: 'failed', message: 'Check-in request failed.' });

    await expect(test.service.run(ACCOUNT_ID)).resolves.toMatchObject({ result: 'failed' });

    expect(test.operations[0]).toMatchObject({ status: 'error', errorCode: 'FAILED' });
    expect(test.storedResults[0]).toMatchObject({ result: 'failed' });
    // API 签到失败后打开站点用户中心，便于手动处理。
    expect(test.opened).toEqual([{ startUrl: 'https://newapi.example.com/profile' }]);
  });

  it('opens external check-in site without counting as success', async () => {
    const operations: OperationEntity[] = [];
    const storedResults: StoredCheckInResult[] = [];
    const opened: Array<{ startUrl: string }> = [];
    const service = new CheckInService({
      accountRepository: {
        get: () => ({ ...account, siteId: 'site-1', authRefId: null }),
      },
      authStateRepository: { getSiteUserId: () => '42' },
      adapterRegistry: {
        get: () => ({ checkIn: async () => ({ accountId: ACCOUNT_ID, result: 'success', message: 'unused' }) } as never),
      },
      operationRepository: { record: operation => operations.push(operation) },
      checkInResultRepository: { record: stored => storedResults.push(stored) },
      siteRepository: {
        get: () => ({
          id: 'site-1',
          name: 'S',
          platform: 'newapi',
          baseUrl: account.baseUrl,
          routeProfile: 'modern',
          useProxy: false,
          enabled: true,
          tags: [],
          autoLogin: false,
          autoCheckIn: false,
          checkInSiteUrl: 'https://checkin.example.com/path',
          recordVersion: 1,
          createdAt: '',
          updatedAt: '',
        }),
      },
      browserContainer: {
        open: async request => {
          opened.push({ startUrl: request.startUrl });
          return {} as never;
        },
      },
      now: () => '2026-01-02T00:00:00.000Z',
    });

    await expect(service.run(ACCOUNT_ID)).resolves.toMatchObject({
      result: 'challenge_required',
      message: '已打开签到站，请在页面中手动完成签到。',
    });
    expect(opened).toEqual([{ startUrl: 'https://checkin.example.com/path' }]);
    expect(operations[0]?.status).toBe('error');
    expect(storedResults[0]?.result).toBe('challenge_required');
  });

  it('rejects an unknown account before invoking an adapter', async () => {
    const test = createService({ accountId: ACCOUNT_ID, result: 'success', message: 'unused' }, false);

    await expect(test.service.run(ACCOUNT_ID)).rejects.toEqual(
      new AppError('ACCOUNT_NOT_FOUND', 'Account was not found.'),
    );
    expect(test.calls()).toBe(0);
    expect(test.operations).toEqual([]);
  });
});
