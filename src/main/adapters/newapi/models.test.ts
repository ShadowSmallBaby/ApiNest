import { parseAvailableModels, parseNewApiModels } from './models';

describe('parseAvailableModels', () => {
  it('parses a top-level string array', () => {
    const set = parseAvailableModels(JSON.stringify(['gpt-4o', 'claude-3-5-sonnet']));
    expect(set).not.toBeNull();
    expect(set?.has('gpt-4o')).toBe(true);
    expect(set?.has('claude-3-5-sonnet')).toBe(true);
  });

  it('parses the {success,data} envelope', () => {
    const set = parseAvailableModels(JSON.stringify({ success: true, data: ['gpt-4o'] }));
    expect(set?.has('gpt-4o')).toBe(true);
  });

  it('filters out non-string and empty entries', () => {
    const set = parseAvailableModels(JSON.stringify(['gpt-4o', 42, '', '  ', null]));
    expect(set?.size).toBe(1);
    expect(set?.has('gpt-4o')).toBe(true);
  });

  it('returns an empty set for an empty list (not null)', () => {
    const set = parseAvailableModels(JSON.stringify([]));
    expect(set).not.toBeNull();
    expect(set?.size).toBe(0);
  });

  it('returns null for success:false', () => {
    expect(parseAvailableModels(JSON.stringify({ success: false }))).toBeNull();
  });

  it('returns null for non-JSON or empty body', () => {
    expect(parseAvailableModels('')).toBeNull();
    expect(parseAvailableModels('<html>login</html>')).toBeNull();
  });
});

describe('parseNewApiModels', () => {
  const pricingBody = JSON.stringify({
    success: true,
    data: [
      {
        model_name: 'gpt-4o',
        quota_type: 0,
        model_ratio: 2.5,
        completion_ratio: 4,
        model_price: 0,
        enable_groups: ['default', 'vip'],
        supported_endpoint_types: ['chat/completions'],
      },
      {
        model_name: 'dall-e-3',
        quota_type: 1,
        model_ratio: 0,
        completion_ratio: 0,
        model_price: 0.04,
        enable_groups: ['default'],
        supported_endpoint_types: ['image/generations'],
      },
    ],
    group_ratio: { default: 1, vip: 0.5 },
    usable_group: { default: '默认分组' },
  });

  it('parses pricing rows into model records', () => {
    const result = parseNewApiModels(pricingBody, new Set(['gpt-4o']));
    expect(result).toHaveLength(2);
    expect(result?.[0]).toEqual({
      modelName: 'gpt-4o',
      quotaType: 0,
      modelRatio: 2.5,
      completionRatio: 4,
      modelPrice: 0,
      enableGroups: ['default', 'vip'],
      supportedEndpointTypes: ['chat/completions'],
      availableForAccount: true,
    });
  });

  it('marks availability based on the available-models set', () => {
    const result = parseNewApiModels(pricingBody, new Set(['gpt-4o']));
    expect(result?.find(m => m.modelName === 'gpt-4o')?.availableForAccount).toBe(true);
    expect(result?.find(m => m.modelName === 'dall-e-3')?.availableForAccount).toBe(false);
  });

  it('conservatively marks all unavailable when the set is null', () => {
    const result = parseNewApiModels(pricingBody, null);
    expect(result?.every(m => m.availableForAccount === false)).toBe(true);
  });

  it('parses a top-level array shape', () => {
    const body = JSON.stringify([
      { model_name: 'gpt-4o', quota_type: 0, model_ratio: 1, completion_ratio: 1, model_price: 0 },
    ]);
    const result = parseNewApiModels(body, null);
    expect(result).toHaveLength(1);
    expect(result?.[0].modelName).toBe('gpt-4o');
  });

  it('applies conservative defaults for missing numeric/array fields', () => {
    const body = JSON.stringify({ success: true, data: [{ model_name: 'x-model' }] });
    const result = parseNewApiModels(body, null);
    expect(result?.[0]).toMatchObject({
      quotaType: 0,
      modelRatio: 0,
      completionRatio: 0,
      modelPrice: 0,
      enableGroups: [],
      supportedEndpointTypes: [],
    });
  });

  it('skips rows without a model_name', () => {
    const body = JSON.stringify({ success: true, data: [{ quota_type: 0 }, { model_name: 'ok' }] });
    const result = parseNewApiModels(body, null);
    expect(result).toHaveLength(1);
    expect(result?.[0].modelName).toBe('ok');
  });

  it('returns null for success:false', () => {
    expect(parseNewApiModels(JSON.stringify({ success: false }), null)).toBeNull();
  });

  it('returns null for non-JSON or empty body', () => {
    expect(parseNewApiModels('', null)).toBeNull();
    expect(parseNewApiModels('<html>login</html>', null)).toBeNull();
  });

  it('returns null when data is not an array', () => {
    expect(parseNewApiModels(JSON.stringify({ success: true, data: { model_name: 'x' } }), null)).toBeNull();
  });

  it('returns an empty array for empty pricing data (not null)', () => {
    const result = parseNewApiModels(JSON.stringify({ success: true, data: [], group_ratio: {}, usable_group: {} }), null);
    expect(result).toEqual([]);
  });
});
