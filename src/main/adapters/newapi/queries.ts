/**
 * NewAPI 用户侧信息解析（纯函数）。
 *
 * 红线：字段缺失、null、NaN、非有限数值一律返回 null（表示"本项不可用"），
 * 绝不伪造 0；API 失败绝不映射为零余额/零用量。上层据 null 保留最近成功快照。
 */

/** 用户资料快照。 */
export interface ProfileSnapshot {
  username?: string;
  /** 数据语义来源标识（接口路径）。 */
  source: string;
}

/** 余额/额度快照。 */
export interface BalanceSnapshot {
  /** 剩余额度（NewAPI quota 语义原值）。 */
  remaining: number;
  /** 单位语义（NewAPI 以 quota 计）。 */
  unit: string;
  source: string;
}

/** 用量快照。 */
export interface UsageSnapshot {
  /** 已用额度（NewAPI used_quota 语义原值）。 */
  used: number;
  unit: string;
  source: string;
}

const PROFILE_SOURCE = 'newapi:/api/user/self';

/**
 * 尝试将响应体解析为 JSON 对象；失败返回 null（不抛错）。
 */
function tryParseJsonObject(bodyText: string): Record<string, unknown> | null {
  const trimmed = bodyText.trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 提取 NewAPI 响应中的用户数据载荷。
 *
 * `success: false` 视为不可用（返回 null）；数据可能位于 `data` 字段或顶层。
 */
function extractUserData(bodyText: string): Record<string, unknown> | null {
  const json = tryParseJsonObject(bodyText);
  if (!json) {
    return null;
  }

  if (json.success === false) {
    return null;
  }

  if (typeof json.data === 'object' && json.data !== null && !Array.isArray(json.data)) {
    return json.data as Record<string, unknown>;
  }

  return json;
}

/**
 * 仅当值为有限数值时采纳；否则返回 null（绝不伪造 0）。
 */
function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * 解析用户资料。无合法身份字段则返回 null（不伪造空资料）。
 */
export function parseNewApiProfile(bodyText: string): ProfileSnapshot | null {
  const data = extractUserData(bodyText);
  if (!data) {
    return null;
  }

  const username =
    typeof data.username === 'string' && data.username.trim().length > 0
      ? data.username.trim()
      : undefined;

  const id = data.id;
  const hasId = typeof id === 'number' || (typeof id === 'string' && id.trim().length > 0);

  // 无任何稳定身份字段时视为不可用。
  if (!username && !hasId) {
    return null;
  }

  return { username, source: PROFILE_SOURCE };
}

/**
 * 解析余额/额度。quota 字段缺失或非法则返回 null（绝不伪造 0 余额）。
 */
export function parseNewApiBalance(bodyText: string): BalanceSnapshot | null {
  const data = extractUserData(bodyText);
  if (!data) {
    return null;
  }

  const remaining = finiteNumberOrNull(data.quota);
  if (remaining === null) {
    return null;
  }

  return { remaining, unit: 'quota', source: PROFILE_SOURCE };
}

/**
 * 解析用量。used_quota 字段缺失或非法则返回 null（绝不伪造 0 用量）。
 */
export function parseNewApiUsage(bodyText: string): UsageSnapshot | null {
  const data = extractUserData(bodyText);
  if (!data) {
    return null;
  }

  const used = finiteNumberOrNull(data.used_quota);
  if (used === null) {
    return null;
  }

  return { used, unit: 'quota', source: PROFILE_SOURCE };
}
