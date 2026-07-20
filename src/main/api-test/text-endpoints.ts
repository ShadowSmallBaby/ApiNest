import type { TextApiEndpoint } from '../../shared/ipc/bridge';

interface TextEndpointDefinition {
  endpoint: TextApiEndpoint;
  path(modelId: string): string;
  defaultBody(modelId: string, message: string): Record<string, unknown>;
  authHeaders(apiKey: string): Record<string, string>;
}

const ENDPOINTS: Record<TextApiEndpoint, TextEndpointDefinition> = {
  openai_chat_completions: {
    endpoint: 'openai_chat_completions',
    path: () => '/v1/chat/completions',
    defaultBody: (model, message) => ({
      model,
      messages: [{ role: 'user', content: message }],
      stream: false,
    }),
    authHeaders: apiKey => ({ authorization: `Bearer ${apiKey}` }),
  },
  openai_responses: {
    endpoint: 'openai_responses',
    path: () => '/v1/responses',
    defaultBody: (model, message) => ({ model, input: message, stream: false }),
    authHeaders: apiKey => ({ authorization: `Bearer ${apiKey}` }),
  },
  anthropic_messages: {
    endpoint: 'anthropic_messages',
    path: () => '/v1/messages',
    defaultBody: (model, message) => ({
      model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: message }],
      stream: false,
    }),
    authHeaders: apiKey => ({ 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }),
  },
  interactions: {
    endpoint: 'interactions',
    path: () => '/v1/interactions',
    defaultBody: (model, message) => ({ model, input: message }),
    authHeaders: apiKey => ({ authorization: `Bearer ${apiKey}` }),
  },
  google_generate_content: {
    endpoint: 'google_generate_content',
    path: model => `/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    defaultBody: (_model, message) => ({
      contents: [{ role: 'user', parts: [{ text: message }] }],
    }),
    authHeaders: apiKey => ({ 'x-goog-api-key': apiKey }),
  },
};

export interface ResolvedTextEndpoint {
  url: string;
  body: Record<string, unknown>;
  authHeaders: Record<string, string>;
}

/** 将固定端点枚举解析为同源 URL、内置正文和认证头。 */
export function resolveTextEndpoint(
  baseUrl: string,
  endpoint: TextApiEndpoint,
  modelId: string,
  message: string,
  apiKey: string,
): ResolvedTextEndpoint {
  const definition = ENDPOINTS[endpoint];
  const base = new URL(baseUrl);
  const target = new URL(definition.path(modelId), base);
  if (target.origin !== base.origin) {
    throw new Error('API test endpoint must use the account origin.');
  }
  return {
    url: target.toString(),
    body: definition.defaultBody(modelId, message),
    authHeaders: definition.authHeaders(apiKey),
  };
}

/** 上游模型端点字符串映射到安全端点枚举；未知值绝不变成请求路径。 */
export function endpointsForSupportedTypes(types: string[]): TextApiEndpoint[] {
  const result = new Set<TextApiEndpoint>();
  for (const raw of types) {
    const value = raw.trim().toLowerCase().replace(/^\/+|\/+$/g, '');
    if (value.endsWith('chat/completions') || value === 'chat') result.add('openai_chat_completions');
    if (value.endsWith('responses') || value === 'response') result.add('openai_responses');
    if (value.endsWith('messages') || value === 'message') result.add('anthropic_messages');
    if (value.endsWith('interactions') || value === 'interaction') result.add('interactions');
    if (value.includes('generatecontent')) result.add('google_generate_content');
  }
  return [...result];
}
