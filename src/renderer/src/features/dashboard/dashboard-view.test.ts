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
        { kind: 'balance', payloadJson: '{"remaining":1000000,"quotaPerUnit":500000}', semanticUnit: 'quota', fetchedAt: '2026-01-01T00:00:00.000Z' },
        { kind: 'usage', payloadJson: '{"used":150000,"quotaPerUnit":500000}', semanticUnit: 'quota', fetchedAt: '2026-01-01T00:00:00.000Z' },
      ],
      operations: [],
    },
    {
      account: {
        id: 'b', platform: 'newapi', baseUrl: 'https://b.example.com', displayName: 'Beta', authState: 'expired',
      },
      snapshots: [
        { kind: 'balance', payloadJson: '{"remaining":500000,"quotaPerUnit":500000}', semanticUnit: 'quota', fetchedAt: '2026-01-01T00:00:00.000Z' },
        { kind: 'usage', payloadJson: '{"used":100000,"quotaPerUnit":500000}', semanticUnit: 'quota', fetchedAt: '2026-01-01T00:00:00.000Z' },
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

  it('aggregates and converts quota to USD', () => {
    // Alpha: 1000000/500000 = 2, Beta: 500000/500000 = 1 → total 3
    expect(aggregateSnapshot(overview.accounts, 'balance')).toEqual({ value: 3, unit: 'USD' });
    // Alpha: 150000/500000 = 0.3, Beta: 100000/500000 = 0.2 → total 0.5
    expect(aggregateSnapshot(overview.accounts, 'usage')).toEqual({ value: 0.5, unit: 'USD' });
  });

  it('uses fallback quotaPerUnit=500000 when missing or zero', () => {
    const noQuotaPerUnit: DashboardOverview = {
      accounts: [
        {
          account: overview.accounts[0].account,
          snapshots: [
            { kind: 'balance', payloadJson: '{"remaining":1000000}', semanticUnit: 'quota', fetchedAt: '2026-01-01T00:00:00.000Z' },
          ],
          operations: [],
        },
        {
          account: overview.accounts[1].account,
          snapshots: [
            { kind: 'balance', payloadJson: '{"remaining":500000,"quotaPerUnit":0}', semanticUnit: 'quota', fetchedAt: '2026-01-01T00:00:00.000Z' },
          ],
          operations: [],
        },
      ],
    };
    // Both fallback to 500000: (1000000 + 500000) / 500000 = 3
    expect(aggregateSnapshot(noQuotaPerUnit.accounts, 'balance')).toEqual({ value: 3, unit: 'USD' });
  });

  it('returns null when any account has missing or invalid snapshot', () => {
    expect(aggregateSnapshot([{ ...overview.accounts[0], snapshots: [] }], 'balance')).toBeNull();
    expect(aggregateSnapshot([{
      ...overview.accounts[0],
      snapshots: [{ kind: 'balance', payloadJson: 'bad-json', semanticUnit: 'quota', fetchedAt: '2026-01-01T00:00:00.000Z' }],
    }], 'balance')).toBeNull();
  });

  it('handles mixed quotaPerUnit across accounts correctly', () => {
    const mixed: DashboardOverview = {
      accounts: [
        {
          account: { id: 'a', platform: 'newapi', baseUrl: 'https://a.com', displayName: 'A', authState: 'active' },
          snapshots: [
            { kind: 'balance', payloadJson: '{"remaining":1000000,"quotaPerUnit":500000}', semanticUnit: 'quota', fetchedAt: '2026-01-01T00:00:00.000Z' },
          ],
          operations: [],
        },
        {
          account: { id: 'b', platform: 'newapi', baseUrl: 'https://b.com', displayName: 'B', authState: 'active' },
          snapshots: [
            { kind: 'balance', payloadJson: '{"remaining":2000000,"quotaPerUnit":1000000}', semanticUnit: 'quota', fetchedAt: '2026-01-01T00:00:00.000Z' },
          ],
          operations: [],
        },
      ],
    };
    // A: 1000000/500000 = 2, B: 2000000/1000000 = 2 → total 4
    expect(aggregateSnapshot(mixed.accounts, 'balance')).toEqual({ value: 4, unit: 'USD' });
  });
});
