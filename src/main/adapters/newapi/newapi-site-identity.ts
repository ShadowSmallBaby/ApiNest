/**
 * NewAPI 站内数字用户 ID 提取纯函数。
 *
 * NewAPI 上游 `UserAuth()` 要求请求头 `New-Api-User` 为站内数字用户 ID，且与会话身份匹配。
 * 该 ID 无法通过 API 自举（`/api/user/self` 本身也需该头），唯一初始来源是登录窗口页面的
 * localStorage：default 前端写 `uid`，classic 前端写 `user`（含 `.id`）。
 * 参考 QuantumNous/new-api web 前端与 all-api-hub `accountBootstrap`/`compatHeaders`。
 *
 * 红线：只提取数字用户 ID，绝不读取/返回 access_token 等凭据。
 */

/**
 * 规范化站内用户 ID。
 *
 * 接受数字或十进制数字字符串；去首尾空白；必须是大于 0 的安全整数。
 * 通过则返回规范十进制字符串，否则返回 null（0/负数/小数/非数字/超安全整数均拒绝）。
 */
export function normalizeSiteUserId(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  // 仅接受纯十进制数字串，排除 "1.0"、"1e3"、" 1 2 " 等歧义写法。
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? String(parsed) : null;
}

/** 从 classic 前端的 `localStorage.user`（JSON）中解析候选用户 ID；非法/缺失返回 null。 */
function extractUserIdFromUserJson(userJson: string | null | undefined): string | null {
  if (!userJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(userJson) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return normalizeSiteUserId((parsed as Record<string, unknown>).id);
    }
    return null;
  } catch {
    return null;
  }
}

export interface SiteIdentityCandidates {
  /** default 前端 `localStorage.uid` 原值。 */
  uid: string | null | undefined;
  /** classic 前端 `localStorage.user` 原始 JSON 字符串。 */
  userJson: string | null | undefined;
}

export interface SiteIdentityPick {
  /** 规范化后的站内用户 ID；无有效候选或冲突时为 null。 */
  userId: string | null;
  /** 两个来源都有效但取值不同（不可信，不予持久化）。 */
  conflict: boolean;
}

/**
 * 从 default(`uid`) 与 classic(`user.id`) 两个候选中确定站内用户 ID。
 *
 * - 仅一个有效：采用之；
 * - 两者有效且相同：采用；
 * - 两者有效但不同：冲突（`userId: null, conflict: true`），不持久化；
 * - 皆无效：`userId: null, conflict: false`。
 */
export function pickSiteUserId(candidates: SiteIdentityCandidates): SiteIdentityPick {
  const fromUid = normalizeSiteUserId(candidates.uid);
  const fromUser = extractUserIdFromUserJson(candidates.userJson);

  if (fromUid && fromUser && fromUid !== fromUser) {
    return { userId: null, conflict: true };
  }

  return { userId: fromUid ?? fromUser, conflict: false };
}
