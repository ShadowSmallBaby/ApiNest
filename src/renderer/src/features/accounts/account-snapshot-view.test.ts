import type { AccountSnapshot } from '../../../../shared/ipc/bridge';
import { buildAccountSnapshotView } from './account-snapshot-view';

describe('buildAccountSnapshotView', () => {
  it('returns empty items when there are no snapshots', () => {
    const view = buildAccountSnapshotView([]);

    expect(view.username).toEqual({ value: null, fetchedAt: null });
    expect(view.balance).toEqual({ value: null, fetchedAt: null });
    expect(view.usage).toEqual({ value: null, fetchedAt: null });
  });

  it('maps valid snapshots to display values with unit and time', () => {
    const snapshots: AccountSnapshot[] = [
      {
        kind: 'profile',
        payloadJson: JSON.stringify({ username: '  alice  ' }),
        fetchedAt: '2026-07-13T00:00:00.000Z',
      },
      {
        kind: 'balance',
        payloadJson: JSON.stringify({ remaining: 42 }),
        semanticUnit: 'quota',
        fetchedAt: '2026-07-13T00:01:00.000Z',
      },
      {
        kind: 'usage',
        payloadJson: JSON.stringify({ used: 7 }),
        semanticUnit: 'quota',
        fetchedAt: '2026-07-13T00:02:00.000Z',
      },
    ];

    const view = buildAccountSnapshotView(snapshots);

    expect(view.username).toEqual({ value: 'alice', fetchedAt: '2026-07-13T00:00:00.000Z' });
    expect(view.balance).toEqual({ value: '42 quota', fetchedAt: '2026-07-13T00:01:00.000Z' });
    expect(view.usage).toEqual({ value: '7 quota', fetchedAt: '2026-07-13T00:02:00.000Z' });
  });

  it('keeps value null but preserves time when payload cannot be parsed', () => {
    const snapshots: AccountSnapshot[] = [
      {
        kind: 'balance',
        payloadJson: 'not json',
        semanticUnit: 'quota',
        fetchedAt: '2026-07-13T00:03:00.000Z',
      },
    ];

    const view = buildAccountSnapshotView(snapshots);

    // 红线：解析失败绝不伪造 0，但仍展示缓存时间。
    expect(view.balance).toEqual({ value: null, fetchedAt: '2026-07-13T00:03:00.000Z' });
  });

  it('does not fake zero when numeric fields are missing', () => {
    const snapshots: AccountSnapshot[] = [
      {
        kind: 'balance',
        payloadJson: JSON.stringify({ unit: 'quota' }),
        semanticUnit: 'quota',
        fetchedAt: '2026-07-13T00:04:00.000Z',
      },
      {
        kind: 'usage',
        payloadJson: JSON.stringify({}),
        semanticUnit: 'quota',
        fetchedAt: '2026-07-13T00:05:00.000Z',
      },
    ];

    const view = buildAccountSnapshotView(snapshots);

    expect(view.balance.value).toBeNull();
    expect(view.usage.value).toBeNull();
  });
});
