import type { ModelRecord } from '../../../shared/ipc/bridge';

/**
 * NewAPI 模型定价（/api/pricing）与账户可用模型（/api/user/models）解析（纯函数）。
 *
 * 红线：
 * - 响应结构不可用（非法 JSON、success:false、data 非数组）一律返回 null，
 *   由上层据 null 抛错，绝不以空列表掩盖失败；
 * - 数值字段缺失/非法时取保守缺省（倍率/价格 0），绝不臆造；
 * - availableForAccount 仅当账户可用模型集合明确包含该 model_name 时为 true，
 *   集合不可用（拉取失败）时保守置 false，绝不默认全部可用。
 */

/** NewAPI pricing 行原始 DTO 中本项目用到的字段子集。 */
interface RawPricingRow {
  model_name?: unknown;
  quota_type?: unknown;
  model_ratio?: unknown;
  completion_ratio?: unknown;
  model_price?: unknown;
  enable_groups?: unknown;
  supported_endpoint_types?: unknown;
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

function finiteNumberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

/**
 * 从 /api/pricing 响应提取 pricing 行数组。
 * 兼容 `{success,data}` 信封与顶层直接为数组两种形态；success:false 或结构不符返回 null。
 */
function extractPricingRows(bodyText: string): RawPricingRow[] | null {
  const parsed = tryParseJson(bodyText);
  if (parsed === null) {
    return null;
  }

  if (Array.isArray(parsed)) {
    return parsed as RawPricingRow[];
  }

  if (!isObject(parsed)) {
    return null;
  }

  if (parsed.success === false) {
    return null;
  }

  if (Array.isArray(parsed.data)) {
    return parsed.data as RawPricingRow[];
  }

  return null;
}

/**
 * 解析 /api/user/models 响应为账户可用模型 id 集合。
 * 兼容 `string[]` 与 `{success,data:string[]}` 两种形态；不可用返回 null（区别于空集合）。
 */
export function parseAvailableModels(bodyText: string): Set<string> | null {
  const parsed = tryParseJson(bodyText);
  if (parsed === null) {
    return null;
  }

  let rawList: unknown;
  if (Array.isArray(parsed)) {
    rawList = parsed;
  } else if (isObject(parsed)) {
    if (parsed.success === false) {
      return null;
    }
    rawList = parsed.data;
  } else {
    return null;
  }

  if (!Array.isArray(rawList)) {
    return null;
  }

  return new Set(stringArray(rawList));
}

/**
 * 解析模型定价列表为展示视图。
 *
 * @param pricingBody /api/pricing 响应体
 * @param availableModels 账户可用模型 id 集合；null 表示集合不可用（全部保守置 availableForAccount=false）
 * @returns 结构不可用时 null；可用则返回数组（可能为空）
 */
export function parseNewApiModels(
  pricingBody: string,
  availableModels: Set<string> | null,
): ModelRecord[] | null {
  const rows = extractPricingRows(pricingBody);
  if (rows === null) {
    return null;
  }

  const records: ModelRecord[] = [];
  for (const row of rows) {
    if (!isObject(row)) {
      continue;
    }
    const modelName = typeof row.model_name === 'string' ? row.model_name.trim() : '';
    if (modelName.length === 0) {
      continue;
    }

    records.push({
      modelName,
      quotaType: finiteNumberOr(row.quota_type, 0),
      modelRatio: finiteNumberOr(row.model_ratio, 0),
      completionRatio: finiteNumberOr(row.completion_ratio, 0),
      modelPrice: finiteNumberOr(row.model_price, 0),
      enableGroups: stringArray(row.enable_groups),
      supportedEndpointTypes: stringArray(row.supported_endpoint_types),
      availableForAccount: availableModels !== null && availableModels.has(modelName),
    });
  }

  return records;
}
