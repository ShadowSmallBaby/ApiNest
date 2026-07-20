const FORBIDDEN_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'host',
  'origin',
  'referer',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'upgrade',
  'te',
  'trailer',
]);

const MAX_CUSTOM_HEADERS = 32;
const MAX_HEADER_TOTAL_LENGTH = 32 * 1024;

/** 校验自定义 Header；认证与网络控制头禁止由 Renderer 覆盖。 */
export function sanitizeCustomHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  if (!headers) return {};
  const entries = Object.entries(headers);
  if (entries.length > MAX_CUSTOM_HEADERS) {
    throw new Error('Too many custom headers.');
  }

  const result: Record<string, string> = {};
  let totalLength = 0;
  for (const [rawName, value] of entries) {
    const name = rawName.trim().toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) || /[\r\n]/.test(value)) {
      throw new Error('Custom header contains invalid characters.');
    }
    if (
      FORBIDDEN_HEADER_NAMES.has(name) ||
      name.startsWith('proxy-') ||
      name.startsWith('sec-')
    ) {
      throw new Error(`Custom header is not allowed: ${name}`);
    }
    totalLength += name.length + value.length;
    if (totalLength > MAX_HEADER_TOTAL_LENGTH) {
      throw new Error('Custom headers are too large.');
    }
    result[name] = value;
  }
  return result;
}

/** 自定义正文采用完整替换语义，且只接受 JSON object。 */
export function parseCustomBody(bodyJson: string | undefined): Record<string, unknown> | null {
  if (!bodyJson || bodyJson.trim().length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyJson) as unknown;
  } catch {
    throw new Error('Custom request body must be valid JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Custom request body must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

/** 自定义正文仍锁定选择的模型，并强制非流式；Google 模型位于 URL path。 */
export function enforceTextRequestBody(
  body: Record<string, unknown>,
  modelId: string,
  modelInBody: boolean,
): Record<string, unknown> {
  return {
    ...body,
    ...(modelInBody ? { model: modelId } : {}),
    ...(Object.hasOwn(body, 'stream') ? { stream: false } : {}),
  };
}

/** 响应正文中如被上游回显当前密钥，精确替换后再跨 IPC。 */
export function redactSecret(text: string, secret: string): string {
  if (!secret) return text;
  return text.split(secret).join('[REDACTED]');
}

export function projectSafeResponseHeaders(headers: Record<string, string>): {
  contentType?: string;
  requestId?: string;
} {
  const contentType = headers['content-type'];
  const requestId = headers['request-id'] ?? headers['x-request-id'] ?? headers['anthropic-request-id'];
  return {
    ...(contentType ? { contentType } : {}),
    ...(requestId ? { requestId } : {}),
  };
}
