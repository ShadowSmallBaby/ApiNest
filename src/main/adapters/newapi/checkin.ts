import type { CheckInResult } from '../../../shared/ipc/bridge';

export interface NewApiCheckInSignal {
  status: number;
  bodyText: string;
  /** 响应头（键已小写）；用于识别 Cloudflare challenge，可选以兼容旧调用。 */
  headers?: Record<string, string>;
}

function parseObject(bodyText: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(bodyText) as unknown;
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function hasAlreadyCheckedInMessage(value: unknown): boolean {
  return typeof value === 'string' && /(already|已.*签到|重复.*签到)/i.test(value);
}

/**
 * 识别 Cloudflare 人机校验拦截。
 * 后台 session.fetch 无法执行 JS Challenge / Turnstile，拿到的是 challenge HTML 而非 JSON。
 * 命中后应引导用户在内嵌站点页完成校验（同 partition 下 cf_clearance 可复用）。
 */
function isCloudflareChallenge(signal: NewApiCheckInSignal): boolean {
  const headers = signal.headers ?? {};
  const server = headers['server'] ?? '';
  const statusIsChallenge =
    signal.status === 403 || signal.status === 503 || signal.status === 429;
  const hasCfHeaders =
    headers['cf-mitigated'] !== undefined
    || headers['cf-ray'] !== undefined
    || /cloudflare/i.test(server);

  if (statusIsChallenge && hasCfHeaders) {
    return true;
  }

  // body 特征：即使状态码不在 403/503/429（例如 200 的 interstitial HTML）也能识别。
  return /just a moment|cf-challenge|challenge-platform|turnstile|__cf_chl/i.test(signal.bodyText);
}

/**
 * 将 NewAPI 签到响应保守映射到公开结果。
 * 只认可明确成功；CF 拦截单独识别；未知响应、站点错误与解析失败一律为 failed，绝不伪造成功。
 */
export function classifyNewApiCheckIn(signal: NewApiCheckInSignal): CheckInResult['result'] {
  // CF 优先于 401/403→session_expired，避免把 challenge 误判为会话过期。
  if (isCloudflareChallenge(signal)) {
    return 'challenge_required';
  }

  if (signal.status === 401 || signal.status === 403) {
    return 'session_expired';
  }

  if (signal.status < 200 || signal.status >= 300) {
    return 'failed';
  }

  const payload = parseObject(signal.bodyText);
  if (!payload) {
    return 'failed';
  }

  if (payload.success === true) {
    return 'success';
  }

  if (hasAlreadyCheckedInMessage(payload.message)) {
    return 'already_checked_in';
  }

  return 'failed';
}
