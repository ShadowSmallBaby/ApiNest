import { endpointsForSupportedTypes, resolveTextEndpoint } from './text-endpoints';

describe('resolveTextEndpoint', () => {
  it('builds fixed OpenAI-compatible text endpoints', () => {
    const resolved = resolveTextEndpoint(
      'https://demo.example.com/panel', 'openai_chat_completions', 'gpt-4o', 'hello', 'secret',
    );
    expect(resolved.url).toBe('https://demo.example.com/v1/chat/completions');
    expect(resolved.authHeaders).toEqual({ authorization: 'Bearer secret' });
    expect(resolved.body).toEqual({
      model: 'gpt-4o', messages: [{ role: 'user', content: 'hello' }], stream: false,
    });
  });

  it('builds Anthropic and Google protocol-specific requests', () => {
    const anthropic = resolveTextEndpoint('https://x.example', 'anthropic_messages', 'claude', 'hi', 'key');
    expect(anthropic.url).toBe('https://x.example/v1/messages');
    expect(anthropic.authHeaders).toEqual({ 'x-api-key': 'key', 'anthropic-version': '2023-06-01' });
    expect(anthropic.body).toMatchObject({ model: 'claude', max_tokens: 1024, stream: false });

    const google = resolveTextEndpoint('https://x.example', 'google_generate_content', 'gemini 2', 'hi', 'key');
    expect(google.url).toBe('https://x.example/v1beta/models/gemini%202:generateContent');
    expect(google.authHeaders).toEqual({ 'x-goog-api-key': 'key' });
    expect(google.body).not.toHaveProperty('model');
  });
});

describe('endpointsForSupportedTypes', () => {
  it('maps only known capability strings and deduplicates results', () => {
    expect(endpointsForSupportedTypes([
      'chat/completions', '/v1/messages', 'responses', 'Interactions', 'generateContent', 'unknown/path', 'chat/completions',
    ])).toEqual([
      'openai_chat_completions', 'anthropic_messages', 'openai_responses', 'interactions', 'google_generate_content',
    ]);
  });
});
