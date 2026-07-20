import type { SessionValidationOutcome } from '../../auth/session-validator';

/**
 * NewAPI 会话判定输入信号（已从 HTTP 响应提取的最小必要字段）。
 */
export interface NewApiSessionSignal {
  status: number;
  bodyText: string;
}

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
 * 判定 data 载荷是否包含稳定的用户身份字段。
 *
 * 只认明确的身份标识（id / username），绝不以余额、额度、用量等业务数值
 * 或空对象推断登录成功。身份字段缺失即视为无法确认。
 */
function hasUserIdentity(data: Record<string, unknown>): boolean {
  const id = data.id;
  const hasId = typeof id === 'number' || (typeof id === 'string' && id.trim().length > 0);

  const username = data.username;
  const hasUsername = typeof username === 'string' && username.trim().length > 0;

  return hasId || hasUsername;
}

/**
 * NewAPI 会话状态分类（纯函数）。
 *
 * 红线：绝不以余额/额度/用量数值或空数据推断 `active`；身份字段缺失即 `unknown`。
 * 明确四态：active / expired / unknown / error（error 由编排层在网络异常时给出）。
 */
export function classifyNewApiSession(signal: NewApiSessionSignal): SessionValidationOutcome {
  const { status, bodyText } = signal;

  // 明确的未认证状态。
  if (status === 401 || status === 403) {
    return { state: 'expired' };
  }

  // 站点服务端错误：不伪造业务成功，交由上层记为 error。
  if (status >= 500) {
    return {
      state: 'error',
      errorCode: 'SITE_ERROR',
      errorSummary: `Site returned status ${status}.`,
    };
  }

  // 仅 2xx 才可能是有效会话。
  if (status < 200 || status >= 300) {
    return { state: 'unknown' };
  }

  const json = tryParseJsonObject(bodyText);
  if (!json) {
    // 非 JSON / 空 body：无法确认，绝不猜为 active。
    return { state: 'unknown' };
  }

  // NewAPI 常见结构：{ success: false, message } 表示未登录/失败。
  if (json.success === false) {
    return { state: 'expired' };
  }

  // 身份数据可能位于 data 字段，或直接位于顶层。
  const data =
    typeof json.data === 'object' && json.data !== null && !Array.isArray(json.data)
      ? (json.data as Record<string, unknown>)
      : json;

  if (hasUserIdentity(data)) {
    return { state: 'active' };
  }

  // 200 但无身份字段（含只有余额/空对象的情况）：不推断成功。
  return { state: 'unknown' };
}
