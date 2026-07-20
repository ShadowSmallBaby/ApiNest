import { describe, expect, it } from 'vitest';
import type { DashboardOverview } from '../../../../shared/ipc/bridge';
import { aggregateSnapshot, buildDashboardStats, filterDashboardAccounts } from './dashboard-view';

const overview: DashboardOverview = {
  accounts: [
    {
      account: {
        id: 'a', platform: 'newapi', baseUrl: 'https://a.example.com', displayName: 'Alpha', authState: 'active',
      },
      snapshots: [
        { kind: 'balance', payloadJson: '{"remaining":10}', semanticUnit: 'quota', fetchedAt: '2026-01-01T00:00:00.000Z' },
        { kind: 'usage', payloadJson: '{"used":3}', semanticUnit: 'quota', fetchedAt: '2026-01-01T00:00:00.000Z' },
      ],
      operations: [],
    },
    {
      account: {
        id: 'b', platform: 'newapi', baseUrl: 'https://b.example.com', displayName: 'Beta', authState: 'expired',
      },
      snapshots: [
        { kind: 'balance', payloadJson: '{"remaining":20}', semanticUnit: 'quota', fetchedAt: '2026-01-01T00:00:00.000Z' },
        { kind: 'usage', payloadJson: '{"used":7}', semanticUnit: 'quota', fetchedAt: '2026-01-01T00:00:00.000Z' },
      ],
      operations: [],
    },
  ],
};

describe('dashboard view', () => {
  it('counts authentication states and filters locally', () => {
    expect(buildDashboardStats(overview)).toEqual({ total: 2, active: 1, expired: 1, error: 0 });
    expect(filterDashboardAccounts(overview.accounts, {
      platform: 'newapi', query: 'alp', authState: 'active',
    })).toEqual([overview.accounts[0]]);
  });

  it('aggregates only snapshots with a matching explicit unit', () => {
    expect(aggregateSnapshot(overview.accounts, 'balance')).toEqual({ value: 30, unit: 'quota' });
    expect(aggregateSnapshot(overview.accounts, 'usage')).toEqual({ value: 10, unit: 'quota' });
  });

  it('never aggregates missing, invalid, or incompatible unit data', () => {
    const incompatible: DashboardOverview = {
      accounts: [
        overview.accounts[0],
        {
          ...overview.accounts[1],
          snapshots: [{ kind: 'balance', payloadJson: '{"remaining":20}', semanticUnit: 'credits', fetchedAt: '2026-01-01T00:00:00.000Z' }],
        },
      ],
    };
    expect(aggregateSnapshot(incompatible.accounts, 'balance')).toBeNull();
    expect(aggregateSnapshot([{ ...overview.accounts[0], snapshots: [] }], 'balance')).toBeNull();
    expect(aggregateSnapshot([{ ...overview.accounts[0], snapshots: [{ kind: 'balance', payloadJson: 'bad-json', semanticUnit: 'quota', fetchedAt: '2026-01-01T00:00:00.000Z' }] }], 'balance')).toBeNull();
  });
});
