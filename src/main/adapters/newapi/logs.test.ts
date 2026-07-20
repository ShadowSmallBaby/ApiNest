import { parseNewApiUsageLogs } from './logs';

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';

function parse(body: unknown) {
  return parseNewApiUsageLogs(JSON.stringify(body), ACCOUNT_ID, 1, 50);
}

describe('parseNewApiUsageLogs', () => {
  const rawItem = {
    id: 99,
    user_id: 7,
    created_at: 1_720_000_000,
    type: 2,
    content: '可能包含敏感上游内容',
    username: 'private-user',
    token_id: 12,
    token_name: 'production',
    model_name: 'gpt-4o',
    quota: 1234,
    prompt_tokens: 100,
    completion_tokens: 20,
    use_time: 1.25,
    is_stream: true,
    channel_id: 5,
    channel_name: 'sensitive-channel',
    group: 'default',
    ip: '192.0.2.1',
    other: '{"authorization":"secret"}',
  };

  it('parses the standard {success,data:{items,total}} envelope', () => {
    const result = parse({ success: true, data: { items: [rawItem], total: 1 } });
    expect(result).toEqual({
      accountId: ACCOUNT_ID,
      page: 1,
      pageSize: 50,
      total: 1,
      items: [{
        accountId: ACCOUNT_ID,
        createdAt: 1_720_000_000,
        type: 2,
        tokenId: 12,
        tokenName: 'production',
        modelName: 'gpt-4o',
        quota: 1234,
        promptTokens: 100,
        completionTokens: 20,
        useTime: 1.25,
        isStream: true,
        group: 'default',
      }],
    });
  });

  it('parses the direct {items,total} shape', () => {
    expect(parse({ items: [rawItem], total: 1 })?.items).toHaveLength(1);
  });

  it('returns a valid empty page instead of null', () => {
    expect(parse({ success: true, data: { items: [], total: 0 } })).toEqual({
      accountId: ACCOUNT_ID,
      page: 1,
      pageSize: 50,
      total: 0,
      items: [],
    });
  });

  it('does not expose content, username, ip, channel or other fields', () => {
    const item = parse({ items: [rawItem], total: 1 })?.items[0] as unknown as Record<string, unknown>;
    expect(item).not.toHaveProperty('content');
    expect(item).not.toHaveProperty('username');
    expect(item).not.toHaveProperty('ip');
    expect(item).not.toHaveProperty('channelId');
    expect(item).not.toHaveProperty('channelName');
    expect(item).not.toHaveProperty('other');
  });

  it('omits invalid optional values rather than fabricating zeros', () => {
    const result = parse({
      items: [{ created_at: 1, type: 5, quota: 'bad', prompt_tokens: -1, use_time: null }],
      total: 1,
    });
    expect(result?.items[0]).toEqual({ accountId: ACCOUNT_ID, createdAt: 1, type: 5 });
  });

  it('skips rows without a valid created_at or type', () => {
    const result = parse({
      items: [{ type: 2 }, { created_at: 1, type: 99 }, rawItem],
      total: 3,
    });
    expect(result?.items).toHaveLength(1);
  });

  it('accepts numeric 0/1 stream flags and trims labels', () => {
    const result = parse({
      items: [{ created_at: 1, type: 2, is_stream: 1, token_name: ' key ', model_name: '  ' }],
      total: 1,
    });
    expect(result?.items[0]).toEqual({
      accountId: ACCOUNT_ID,
      createdAt: 1,
      type: 2,
      tokenName: 'key',
      isStream: true,
    });
  });

  it('returns null for invalid envelopes or totals', () => {
    expect(parseNewApiUsageLogs('', ACCOUNT_ID, 1, 50)).toBeNull();
    expect(parseNewApiUsageLogs('<html>login</html>', ACCOUNT_ID, 1, 50)).toBeNull();
    expect(parse({ success: false, data: { items: [], total: 0 } })).toBeNull();
    expect(parse({ success: true, data: { items: {}, total: 0 } })).toBeNull();
    expect(parse({ success: true, data: { items: [], total: -1 } })).toBeNull();
  });

  it('supports total_count as a known compatibility field', () => {
    expect(parse({ items: [], total_count: 7 })?.total).toBe(7);
  });
});
