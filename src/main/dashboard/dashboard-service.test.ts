import { describe, expect, it } from 'vitest';
import { DashboardService } from './dashboard-service';

describe('DashboardService', () => {
  it('projects only non-sensitive account, snapshot and operation display fields', () => {
    const service = new DashboardService({
      accountService: {
        list: () => [{
          id: '11111111-1111-4111-8111-111111111111',
          platform: 'newapi',
          baseUrl: 'https://example.com',
          displayName: 'Account A',
          authState: 'error',
        }],
      },
      snapshotRepository: {
        getLatest: () => [{
          id: 'internal-snapshot-id',
          accountId: '11111111-1111-4111-8111-111111111111',
          kind: 'balance',
          payloadJson: '{"remaining":10}',
          semanticUnit: 'quota',
          fetchedAt: '2026-01-01T00:00:00.000Z',
          isLatest: true,
        }],
      },
      operationRepository: {
        listRecent: () => [{
          id: 'internal-operation-id',
          accountId: '11111111-1111-4111-8111-111111111111',
          kind: 'refresh',
          status: 'error',
          startedAt: '2026-01-01T00:00:00.000Z',
          errorCode: 'NETWORK_ERROR',
          errorSummary: 'Refresh request failed.',
        }],
      },
    });

    expect(service.getOverview()).toEqual({
      accounts: [{
        account: expect.objectContaining({ displayName: 'Account A', authState: 'error' }),
        snapshots: [{
          kind: 'balance', payloadJson: '{"remaining":10}', semanticUnit: 'quota', fetchedAt: '2026-01-01T00:00:00.000Z',
        }],
        operations: [{
          kind: 'refresh', status: 'error', startedAt: '2026-01-01T00:00:00.000Z',
          errorCode: 'NETWORK_ERROR', errorSummary: 'Refresh request failed.',
        }],
      }],
    });
  });
});
