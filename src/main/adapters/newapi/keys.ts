import type { ApiKeyRecord } from '../../../shared/ipc/bridge';

/**
 * NewAPI 密钥（token）列表解析（纯函数）。
 *
 * 红线：
 * - 响应结构不可用（非法 JSON、success:false、既非数组也无 items）一律返回 null，
 *   由上层据 null 抛错，绝不以空列表掩盖失败；
 * - 数值字段缺失/非法时取保守缺省（额度 0、status 原值），但绝不伪造 key 明文；
 * - listByAccount 路径产出的 key 永远脱敏（maskApiKey），完整明文只走独立 reveal 通道。
 */

/** NewAPI token 原始 DTO 中本项目用到的字段子集。 */
interface RawApiToken {
  id?: unknown;
  key?: unknown;
  name?: unknown;
  group?: unknown;
  remain_quota?: unknown;
  unlimited_quota?: unknown;
  used_quota?: unknown;
  status?: unknown;
  created_time?: unknown;
  expired_time?: unknown;
}

function tryParseJson(bodyText: string): unknown {
  const trimmed = bodyText.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 从响应中提取 token 数组。兼容三种形态：
 * - 顶层直接是数组；
 * - NewAPI 标准信封 `{success,data}`，data 为数组；
 * - 分页信封 `{items}` 或 `{data:{items}}`。
 * 无法提取或 success:false 返回 null。
 */
function extractTokenArray(bodyText: string): RawApiToken[] | null {
  const parsed = tryParseJson(bodyText);
  if (parsed === null) {
    return null;
  }

  if (Array.isArray(parsed)) {
    return parsed as RawApiToken[];
  }

  if (!isObject(parsed)) {
    return null;
  }

  if (parsed.success === false) {
    return null;
  }

  // data 可能是数组或含 items 的对象；顶层也可能直接含 items。
  const data = parsed.data;
  if (Array.isArray(data)) {
    return data as RawApiToken[];
  }
  if (isObject(data) && Array.isArray(data.items)) {
    return data.items as RawApiToken[];
  }
  if (Array.isArray(parsed.items)) {
    return parsed.items as RawApiToken[];
  }

  return null;
}

function finiteNumberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nonEmptyStringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * 脱敏 key：保留前缀语义与末 4 位，绝不返回完整明文。
 * 空串返回空串；短 key（<=8）只留前 2 位。
 */
export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length === 0) {
    return '';
  }
  if (trimmed.length <= 8) {
    return `${trimmed.slice(0, 2)}…`;
  }
  return `${trimmed.slice(0, 3)}…${trimmed.slice(-4)}`;
}

/**
 * 解析密钥列表为脱敏视图。缺少数字 id 的项跳过（无法定位揭示）。
 * 整体不可用返回 null；可用则返回数组（可能为空）。
 */
export function parseNewApiTokens(bodyText: string, accountId: string): ApiKeyRecord[] | null {
  const rawTokens = extractTokenArray(bodyText);
  if (rawTokens === null) {
    return null;
  }

  const records: ApiKeyRecord[] = [];
  for (const raw of rawTokens) {
    if (!isObject(raw)) {
      continue;
    }
    const id = raw.id;
    if (typeof id !== 'number' || !Number.isFinite(id)) {
      continue;
    }

    const key = typeof raw.key === 'string' ? raw.key : '';
    records.push({
      id,
      accountId,
      name: typeof raw.name === 'string' ? raw.name : '',
      maskedKey: maskApiKey(key),
      group: nonEmptyStringOrUndefined(raw.group),
      remainQuota: finiteNumberOr(raw.remain_quota, 0),
      unlimitedQuota: raw.unlimited_quota === true,
      usedQuota: finiteNumberOr(raw.used_quota, 0),
      status: finiteNumberOr(raw.status, 0),
      createdTime: finiteNumberOr(raw.created_time, 0),
      expiredTime: finiteNumberOr(raw.expired_time, -1),
      // 网络层刚解析出的记录，本地必无明文；真实的 hasPlaintext 由 KeysService
      // 从本地密钥表计算后覆盖。此处填 false 仅为满足类型契约。
      hasPlaintext: false,
    });
  }

  return records;
}

/**
 * 从 token 列表响应中取指定 id 的原始 key 串（可能是脱敏值）。
 * 找不到或 key 为空返回 null；仅供主进程内 reveal 通道使用。
 *
 * 注意：现代 NewAPI 列表接口返回的 key 中段以 `*` 脱敏，需用 isMaskedApiTokenKey
 * 判定后回退到 `/api/token/{id}/key` 取真实明文，绝不把脱敏值当明文返回。
 */
export function extractTokenKey(bodyText: string, tokenId: number): string | null {
  const rawTokens = extractTokenArray(bodyText);
  if (rawTokens === null) {
    return null;
  }
  for (const raw of rawTokens) {
    if (isObject(raw) && raw.id === tokenId && typeof raw.key === 'string' && raw.key.length > 0) {
      return raw.key.trim();
    }
  }
  return null;
}

/** key 中段含 `*` 或 `•` 视为脱敏值，不可当凭据直接使用。 */
export function isMaskedApiTokenKey(key: string): boolean {
  const normalized = key.trim();
  return normalized.includes('*') || normalized.includes('•');
}

/** 归一化后非空且未脱敏，才可作为完整明文凭据直接使用。 */
export function hasUsableApiTokenKey(key: string): boolean {
  const normalized = key.trim();
  return normalized.length > 0 && !isMaskedApiTokenKey(normalized);
}

/**
 * 解析 `/api/token/{id}/key` 响应，取完整明文 key。
 * 兼容 `{key}`、`{data:{key}}`、`{data:"sk-..."}` 三种形态；
 * 缺失或仍为脱敏值一律返回 null（绝不返回脱敏串充作明文）。
 */
export function parseTokenSecretKey(bodyText: string): string | null {
  const parsed = tryParseJson(bodyText);
  if (!isObject(parsed) || parsed.success === false) {
    return null;
  }

  const candidates: unknown[] = [parsed.key];
  const data = parsed.data;
  if (typeof data === 'string') {
    candidates.push(data);
  } else if (isObject(data)) {
    candidates.push(data.key);
  }

  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (hasUsableApiTokenKey(trimmed)) {
        return trimmed;
      }
    }
  }
  return null;
}
