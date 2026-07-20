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
      } as never),
    },
    operationRepository: {
      record: operation => operations.push(operation),
    },
    checkInResultRepository: {
      record: stored => storedResults.push(stored),
    },
    now: () => '2026-01-02T00:00:00.000Z',
  });

  return { calls: () => calls, operations, service, storedResults };
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
