import type { AccountSnapshot } from '../../../../shared/ipc/bridge';

/**
 * 账户快照展示模型（纯逻辑）。
 *
 * 红线：无快照或解析失败时字段为 null（UI 显示"暂无数据"），绝不显示伪造的 0；
 * 每项附带获取时间，供 UI 同时展示缓存数据与时间。
 *
 * 汇率换算：
 * - 余额/用量从 quota 原值换算为美元金额（除以 quotaPerUnit）
 * - 余额保留两位小数，用量保留四位小数
 * - quotaPerUnit 缺失时 fallback 到 500000（NewAPI 标准默认值）
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

/** NewAPI 标准默认汇率除数（quota → USD），与 Status 客户端保持一致。 */
const DEFAULT_QUOTA_PER_UNIT = 500000;

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
    if (remaining === null) {
      return { value: null, fetchedAt: balanceSnapshot.fetchedAt };
    }

    // 汇率换算：quota → USD，兼容旧快照 fallback 到默认值
    const quotaPerUnit = data && typeof data.quotaPerUnit === 'number' && data.quotaPerUnit > 0
      ? data.quotaPerUnit
      : DEFAULT_QUOTA_PER_UNIT;
    const usd = remaining / quotaPerUnit;
    const value = `$${usd.toFixed(2)}`; // 余额两位小数

    return { value, fetchedAt: balanceSnapshot.fetchedAt };
  })();

  const usage: SnapshotDisplayItem = (() => {
    if (!usageSnapshot) {
      return EMPTY_ITEM;
    }
    const data = tryParsePayload(usageSnapshot.payloadJson);
    const used = data && typeof data.used === 'number' ? data.used : null;
    if (used === null) {
      return { value: null, fetchedAt: usageSnapshot.fetchedAt };
    }

    // 汇率换算：quota → USD，兼容旧快照 fallback 到默认值
    const quotaPerUnit = data && typeof data.quotaPerUnit === 'number' && data.quotaPerUnit > 0
      ? data.quotaPerUnit
      : DEFAULT_QUOTA_PER_UNIT;
    const usd = used / quotaPerUnit;
    const value = `$${usd.toFixed(4)}`; // 用量四位小数

    return { value, fetchedAt: usageSnapshot.fetchedAt };
  })();

  return { username, balance, usage };
}
