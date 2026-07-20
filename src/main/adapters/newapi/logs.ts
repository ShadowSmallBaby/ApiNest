import type { UsageLogPage, UsageLogRecord, UsageLogType } from '../../../shared/ipc/bridge';

/** NewAPI /api/log/self 原始日志中本项目允许读取的字段子集。 */
interface RawUsageLogRow {
  created_at?: unknown;
  type?: unknown;
  token_id?: unknown;
  token_name?: unknown;
  model_name?: unknown;
  quota?: unknown;
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  use_time?: unknown;
  is_stream?: unknown;
  group?: unknown;
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

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  const parsed = finiteNumber(value);
  return parsed !== undefined && Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isUsageLogType(value: unknown): value is UsageLogType {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6;
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 0 || value === 1) {
    return value === 1;
  }
  return undefined;
}

/** 从标准信封或直接 data 对象中提取 items 与 total。 */
function extractLogData(bodyText: string): { items: unknown[]; total: number } | null {
  const parsed = tryParseJson(bodyText);
  if (!isObject(parsed) || parsed.success === false) {
    return null;
  }

  const data = isObject(parsed.data) ? parsed.data : parsed;
  if (!Array.isArray(data.items)) {
    return null;
  }

  const total = nonNegativeInteger(data.total ?? data.total_count);
  if (total === undefined) {
    return null;
  }
  return { items: data.items, total };
}

/**
 * 解析 /api/log/self 为安全日志分页视图。
 *
 * 红线：
 * - 非法 JSON、success:false 或分页结构不可用返回 null，不以空页掩盖失败；
 * - username、IP、channel、content、other 等自由文本/隐私字段绝不进入返回值；
 * - 行缺少 created_at/type 时跳过，数值可选字段非法时省略，绝不伪造 0。
 */
export function parseNewApiUsageLogs(
  bodyText: string,
  accountId: string,
  page: number,
  pageSize: number,
): UsageLogPage | null {
  const data = extractLogData(bodyText);
  if (data === null) {
    return null;
  }

  const items: UsageLogRecord[] = [];
  for (const raw of data.items) {
    if (!isObject(raw)) {
      continue;
    }
    const row = raw as RawUsageLogRow;
    const createdAt = nonNegativeInteger(row.created_at);
    if (createdAt === undefined || !isUsageLogType(row.type)) {
      continue;
    }

    const record: UsageLogRecord = {
      accountId,
      createdAt,
      type: row.type,
    };
    const tokenId = nonNegativeInteger(row.token_id);
    const tokenName = nonEmptyString(row.token_name);
    const modelName = nonEmptyString(row.model_name);
    const quota = finiteNumber(row.quota);
    const promptTokens = nonNegativeInteger(row.prompt_tokens);
    const completionTokens = nonNegativeInteger(row.completion_tokens);
    const useTime = finiteNumber(row.use_time);
    const isStream = parseBoolean(row.is_stream);
    const group = nonEmptyString(row.group);

    if (tokenId !== undefined) record.tokenId = tokenId;
    if (tokenName !== undefined) record.tokenName = tokenName;
    if (modelName !== undefined) record.modelName = modelName;
    if (quota !== undefined) record.quota = quota;
    if (promptTokens !== undefined) record.promptTokens = promptTokens;
    if (completionTokens !== undefined) record.completionTokens = completionTokens;
    if (useTime !== undefined) record.useTime = useTime;
    if (isStream !== undefined) record.isStream = isStream;
    if (group !== undefined) record.group = group;
    items.push(record);
  }

  return { accountId, page, pageSize, total: data.total, items };
}
