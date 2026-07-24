import { describe, it, expect } from 'vitest';
import { buildAccountSnapshotView } from './account-snapshot-view';
import type { AccountSnapshot } from '../../../../shared/ipc/bridge';

const NOW = '2026-07-24T12:00:00.000Z';

describe('buildAccountSnapshotView', () => {
  it('返回全 null 当没有快照', () => {
    const view = buildAccountSnapshotView([]);
    expect(view.username).toEqual({ value: null, fetchedAt: null });
    expect(view.balance).toEqual({ value: null, fetchedAt: null });
    expect(view.usage).toEqual({ value: null, fetchedAt: null });
  });

  it('正确解析 profile 快照的 username', () => {
    const snapshots: AccountSnapshot[] = [
      { kind: 'profile', payloadJson: '{"username":"test_user"}', fetchedAt: NOW },
    ];
    const view = buildAccountSnapshotView(snapshots);
    expect(view.username).toEqual({ value: 'test_user', fetchedAt: NOW });
  });

  it('profile 快照无 username 时 value 为 null', () => {
    const snapshots: AccountSnapshot[] = [
      { kind: 'profile', payloadJson: '{"other":"field"}', fetchedAt: NOW },
    ];
    const view = buildAccountSnapshotView(snapshots);
    expect(view.username).toEqual({ value: null, fetchedAt: NOW });
  });

  it('balance 快照换算为 USD 并保留两位小数（使用 quotaPerUnit）', () => {
    const snapshots: AccountSnapshot[] = [
      {
        kind: 'balance',
        payloadJson: '{"remaining":64241873,"quotaPerUnit":500000}',
        fetchedAt: NOW,
        semanticUnit: 'quota',
      },
    ];
    const view = buildAccountSnapshotView(snapshots);
    expect(view.balance).toEqual({ value: '$128.48', fetchedAt: NOW });
  });

  it('balance 快照缺失 quotaPerUnit 时 fallback 到 500000', () => {
    const snapshots: AccountSnapshot[] = [
      {
        kind: 'balance',
        payloadJson: '{"remaining":1000000}',
        fetchedAt: NOW,
        semanticUnit: 'quota',
      },
    ];
    const view = buildAccountSnapshotView(snapshots);
    expect(view.balance).toEqual({ value: '$2.00', fetchedAt: NOW });
  });

  it('balance 快照 quotaPerUnit=0 时 fallback 到 500000', () => {
    const snapshots: AccountSnapshot[] = [
      {
        kind: 'balance',
        payloadJson: '{"remaining":500000,"quotaPerUnit":0}',
        fetchedAt: NOW,
        semanticUnit: 'quota',
      },
    ];
    const view = buildAccountSnapshotView(snapshots);
    expect(view.balance).toEqual({ value: '$1.00', fetchedAt: NOW });
  });

  it('usage 快照换算为 USD 并保留四位小数（使用 quotaPerUnit）', () => {
    const snapshots: AccountSnapshot[] = [
      {
        kind: 'usage',
        payloadJson: '{"used":123456,"quotaPerUnit":500000}',
        fetchedAt: NOW,
        semanticUnit: 'quota',
      },
    ];
    const view = buildAccountSnapshotView(snapshots);
    expect(view.usage).toEqual({ value: '$0.2469', fetchedAt: NOW });
  });

  it('usage 快照缺失 quotaPerUnit 时 fallback 到 500000', () => {
    const snapshots: AccountSnapshot[] = [
      {
        kind: 'usage',
        payloadJson: '{"used":250000}',
        fetchedAt: NOW,
        semanticUnit: 'quota',
      },
    ];
    const view = buildAccountSnapshotView(snapshots);
    expect(view.usage).toEqual({ value: '$0.5000', fetchedAt: NOW });
  });

  it('balance/usage 快照解析失败时 value 为 null 但保留 fetchedAt', () => {
    const snapshots: AccountSnapshot[] = [
      { kind: 'balance', payloadJson: '{invalid', fetchedAt: NOW, semanticUnit: 'quota' },
      { kind: 'usage', payloadJson: '[]', fetchedAt: NOW, semanticUnit: 'quota' },
    ];
    const view = buildAccountSnapshotView(snapshots);
    expect(view.balance).toEqual({ value: null, fetchedAt: NOW });
    expect(view.usage).toEqual({ value: null, fetchedAt: NOW });
  });

  it('完整场景：三类快照都有效并正确换算', () => {
    const snapshots: AccountSnapshot[] = [
      { kind: 'profile', payloadJson: '{"username":"alice"}', fetchedAt: NOW },
      {
        kind: 'balance',
        payloadJson: '{"remaining":10000000,"quotaPerUnit":500000}',
        fetchedAt: NOW,
        semanticUnit: 'quota',
      },
      {
        kind: 'usage',
        payloadJson: '{"used":987654,"quotaPerUnit":500000}',
        fetchedAt: NOW,
        semanticUnit: 'quota',
      },
    ];
    const view = buildAccountSnapshotView(snapshots);
    expect(view.username).toEqual({ value: 'alice', fetchedAt: NOW });
    expect(view.balance).toEqual({ value: '$20.00', fetchedAt: NOW });
    expect(view.usage).toEqual({ value: '$1.9753', fetchedAt: NOW });
  });
});
