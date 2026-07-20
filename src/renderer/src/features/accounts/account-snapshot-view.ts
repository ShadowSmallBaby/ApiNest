import type { AccountSnapshot } from '../../../../shared/ipc/bridge';

/**
 * 账户快照展示模型（纯逻辑）。
 *
 * 红线：无快照或解析失败时字段为 null（UI 显示"暂无数据"），绝不显示伪造的 0；
 * 每项附带获取时间，供 UI 同时展示缓存数据与时间。
 */

export interface SnapshotDisplayItem {
  /** 展示值；无数据/解析失败为 null（不显示 0）。 */
  value: string | null;
  /** 数据获取时间（ISO），无快照为 null。 */
  fetchedAt: string | null;
}

export interface AccountSnapshotView {
  username: SnapshotDisplayItem;
  balance: SnapshotDisplayItem;
  usage: SnapshotDisplayItem;
}

const EMPTY_ITEM: SnapshotDisplayItem = { value: null, fetchedAt: null };

function tryParsePayload(payloadJson: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(payloadJson) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function findSnapshot(
  snapshots: AccountSnapshot[],
  kind: AccountSnapshot['kind'],
): AccountSnapshot | undefined {
  return snapshots.find(snapshot => snapshot.kind === kind);
}

/**
 * 将快照数组映射为展示模型。
 *
 * 解析失败或字段缺失的项保持 null（不伪造 0）；有效项显示原值 + 单位（若有）。
 */
export function buildAccountSnapshotView(snapshots: AccountSnapshot[]): AccountSnapshotView {
  const profileSnapshot = findSnapshot(snapshots, 'profile');
  const balanceSnapshot = findSnapshot(snapshots, 'balance');
  const usageSnapshot = findSnapshot(snapshots, 'usage');

  const username: SnapshotDisplayItem = (() => {
    if (!profileSnapshot) {
      return EMPTY_ITEM;
    }
    const data = tryParsePayload(profileSnapshot.payloadJson);
    const value =
      data && typeof data.username === 'string' && data.username.trim().length > 0
        ? data.username.trim()
        : null;
    return { value, fetchedAt: profileSnapshot.fetchedAt };
  })();

  const balance: SnapshotDisplayItem = (() => {
    if (!balanceSnapshot) {
      return EMPTY_ITEM;
    }
    const data = tryParsePayload(balanceSnapshot.payloadJson);
    const remaining = data && typeof data.remaining === 'number' ? data.remaining : null;
    const value =
      remaining === null
        ? null
        : `${remaining}${balanceSnapshot.semanticUnit ? ` ${balanceSnapshot.semanticUnit}` : ''}`;
    return { value, fetchedAt: balanceSnapshot.fetchedAt };
  })();

  const usage: SnapshotDisplayItem = (() => {
    if (!usageSnapshot) {
      return EMPTY_ITEM;
    }
    const data = tryParsePayload(usageSnapshot.payloadJson);
    const used = data && typeof data.used === 'number' ? data.used : null;
    const value =
      used === null
        ? null
        : `${used}${usageSnapshot.semanticUnit ? ` ${usageSnapshot.semanticUnit}` : ''}`;
    return { value, fetchedAt: usageSnapshot.fetchedAt };
  })();

  return { username, balance, usage };
}
