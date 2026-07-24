import type { ProbeClient } from '../probe-client';

/**
 * NewAPI /api/status 站点公开信息响应（已解析并 fallback 的汇率除数）。
 */
export interface SiteStatusResponse {
  /**
   * quota → USD 汇率除数（NewAPI 标准默认 500000）。
   * 已经过解析与 fallback，保证为正数，可直接用于换算。
   */
  quotaPerUnit: number;
}

/**
 * NewAPI 标准默认汇率除数（quota → USD）。
 * 参考 all-api-hub UI_CONSTANTS.EXCHANGE_RATE.CONVERSION_FACTOR。
 */
export const DEFAULT_QUOTA_PER_UNIT = 500000;

/**
 * 从 /api/status 响应体文本解析 quota_per_unit。
 *
 * 红线：
 * - 字段缺失/非正数/解析失败 → fallback 到 DEFAULT_QUOTA_PER_UNIT（500000）
 * - 绝不抛错，保证返回可用正数
 * - 不记录原始响应体或敏感内容到日志
 *
 * NewAPI 响应结构（可能变体）：
 * 1. `{success: true, data: {quota_per_unit: 500000, ...}}`
 * 2. `{quota_per_unit: 500000, ...}` （顶层直接暴露）
 * 3. 字段完全缺失或为 null/0/负数
 */
export function parseQuotaPerUnit(bodyText: string): number {
  const trimmed = bodyText.trim();
  if (trimmed.length === 0) {
    return DEFAULT_QUOTA_PER_UNIT;
  }

  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return DEFAULT_QUOTA_PER_UNIT;
  }

  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return DEFAULT_QUOTA_PER_UNIT;
  }

  const obj = json as Record<string, unknown>;

  // 尝试从 data 字段提取（标准 NewAPI 响应包装）
  let candidate: unknown;
  if (typeof obj.data === 'object' && obj.data !== null && !Array.isArray(obj.data)) {
    const data = obj.data as Record<string, unknown>;
    candidate = data.quota_per_unit;
  } else {
    // 尝试从顶层直接提取
    candidate = obj.quota_per_unit;
  }

  // 校验候选值是否为正数
  if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
    return candidate;
  }

  // 所有失败路径都 fallback 到默认值
  return DEFAULT_QUOTA_PER_UNIT;
}

/**
 * NewAPI 站点状态查询客户端（公开接口，无需认证）。
 *
 * 职责：
 * - 对站点 baseUrl 发起公开 /api/status 请求
 * - 解析 quota_per_unit 汇率除数
 * - 任何失败场景（网络错误、解析失败、字段缺失）静默 fallback 到 500000
 * - 绝不阻塞刷新流程，绝不抛错
 */
export class NewApiStatusClient {
  constructor(private readonly probeClient: ProbeClient) {}

  /**
   * 获取站点状态信息（汇率除数）。
   *
   * @param baseUrl 站点根 URL（如 `https://api.example.com`）
   * @returns 保证返回有效的 quotaPerUnit（≥1），请求失败时 fallback 到 500000
   */
  async fetchStatus(baseUrl: string): Promise<SiteStatusResponse> {
    const url = new URL('/api/status', baseUrl).toString();

    let bodyText: string;
    try {
      const response = await this.probeClient.fetchProbe(url, {
        timeoutMs: 5000, // 快速失败，不阻塞主刷新流程
        useProxy: false, // 公开接口，使用直连探测 partition
      });

      // 非 2xx 也尝试解析（部分实例可能 404 但仍有 body）
      bodyText = response.bodyText ?? '';
    } catch {
      // 网络错误、超时等静默 fallback
      return { quotaPerUnit: DEFAULT_QUOTA_PER_UNIT };
    }

    const quotaPerUnit = parseQuotaPerUnit(bodyText);
    return { quotaPerUnit };
  }
}
