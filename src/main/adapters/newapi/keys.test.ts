import {
  extractTokenKey,
  hasUsableApiTokenKey,
  isMaskedApiTokenKey,
  maskApiKey,
  parseNewApiTokens,
  parseTokenSecretKey,
} from './keys';

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';

describe('maskApiKey', () => {
  it('masks a normal key keeping prefix and last 4', () => {
    expect(maskApiKey('sk-abcdefghijklmnop')).toBe('sk-…mnop');
  });

  it('masks a short key with only prefix', () => {
    expect(maskApiKey('sk-123')).toBe('sk…');
  });

  it('returns empty string for empty key', () => {
    expect(maskApiKey('')).toBe('');
    expect(maskApiKey('   ')).toBe('');
  });

  it('never returns the full key', () => {
    const full = 'sk-verysecretkey1234';
    expect(maskApiKey(full)).not.toBe(full);
    expect(maskApiKey(full)).not.toContain('verysecret');
  });
});

describe('parseNewApiTokens', () => {
  it('parses a top-level array of tokens with masked keys', () => {
    const body = JSON.stringify([
      {
        id: 1,
        key: 'sk-abcdefghijklmnop',
        name: 'default',
        group: 'vip',
        remain_quota: 5000,
        unlimited_quota: false,
        used_quota: 120,
        status: 1,
        created_time: 1700000000,
        expired_time: -1,
      },
    ]);
    const result = parseNewApiTokens(body, ACCOUNT_ID);
    expect(result).toEqual([
      {
        id: 1,
        accountId: ACCOUNT_ID,
        name: 'default',
        maskedKey: 'sk-…mnop',
        group: 'vip',
        remainQuota: 5000,
        unlimitedQuota: false,
        usedQuota: 120,
        status: 1,
        createdTime: 1700000000,
        expiredTime: -1,
      },
    ]);
  });

  it('never leaks the full key in the masked view', () => {
    const body = JSON.stringify([{ id: 1, key: 'sk-supersecretvalue9999' }]);
    const result = parseNewApiTokens(body, ACCOUNT_ID);
    expect(result?.[0].maskedKey).not.toContain('supersecret');
  });

  it('parses the standard {success,data} envelope', () => {
    const body = JSON.stringify({ success: true, data: [{ id: 7, key: 'sk-xxxxxxxxxxxx' }] });
    const result = parseNewApiTokens(body, ACCOUNT_ID);
    expect(result).toHaveLength(1);
    expect(result?.[0].id).toBe(7);
  });

  it('parses the paginated {items} envelope', () => {
    const body = JSON.stringify({ items: [{ id: 3, key: 'sk-yyyyyyyyyyyy' }], total: 1 });
    const result = parseNewApiTokens(body, ACCOUNT_ID);
    expect(result).toHaveLength(1);
    expect(result?.[0].id).toBe(3);
  });

  it('parses the nested {data:{items}} envelope', () => {
    const body = JSON.stringify({ success: true, data: { items: [{ id: 9, key: 'sk-zzzzzzzzzzzz' }], total: 1 } });
    const result = parseNewApiTokens(body, ACCOUNT_ID);
    expect(result).toHaveLength(1);
    expect(result?.[0].id).toBe(9);
  });

  it('skips tokens without a numeric id', () => {
    const body = JSON.stringify([{ key: 'sk-noid' }, { id: 5, key: 'sk-hasid123456' }]);
    const result = parseNewApiTokens(body, ACCOUNT_ID);
    expect(result).toHaveLength(1);
    expect(result?.[0].id).toBe(5);
  });

  it('applies conservative defaults for missing numeric fields', () => {
    const body = JSON.stringify([{ id: 1, key: 'sk-defaults1234' }]);
    const result = parseNewApiTokens(body, ACCOUNT_ID);
    expect(result?.[0]).toMatchObject({
      remainQuota: 0,
      usedQuota: 0,
      status: 0,
      createdTime: 0,
      expiredTime: -1,
      unlimitedQuota: false,
    });
  });

  it('returns null for success:false', () => {
    const body = JSON.stringify({ success: false, message: 'not logged in' });
    expect(parseNewApiTokens(body, ACCOUNT_ID)).toBeNull();
  });

  it('returns null for non-JSON or empty body', () => {
    expect(parseNewApiTokens('', ACCOUNT_ID)).toBeNull();
    expect(parseNewApiTokens('<html>login</html>', ACCOUNT_ID)).toBeNull();
  });

  it('returns null when the shape is neither array nor items envelope', () => {
    const body = JSON.stringify({ success: true, data: { quota: 100 } });
    expect(parseNewApiTokens(body, ACCOUNT_ID)).toBeNull();
  });

  it('returns an empty array for an empty token list (not null)', () => {
    expect(parseNewApiTokens(JSON.stringify([]), ACCOUNT_ID)).toEqual([]);
  });
});

describe('extractTokenKey', () => {
  it('returns the full key for the matching token id', () => {
    const body = JSON.stringify([
      { id: 1, key: 'sk-firstkey12345' },
      { id: 2, key: 'sk-secondkey6789' },
    ]);
    expect(extractTokenKey(body, 2)).toBe('sk-secondkey6789');
  });

  it('returns null when the token id is not found', () => {
    const body = JSON.stringify([{ id: 1, key: 'sk-onlykey1234' }]);
    expect(extractTokenKey(body, 99)).toBeNull();
  });

  it('returns null when the matched token has an empty key', () => {
    const body = JSON.stringify([{ id: 1, key: '' }]);
    expect(extractTokenKey(body, 1)).toBeNull();
  });

  it('returns null for an unavailable response', () => {
    expect(extractTokenKey('', 1)).toBeNull();
    expect(extractTokenKey(JSON.stringify({ success: false }), 1)).toBeNull();
  });
});

describe('isMaskedApiTokenKey', () => {
  it('detects keys masked with asterisks', () => {
    expect(isMaskedApiTokenKey('sk-abc****mnop')).toBe(true);
  });

  it('detects keys masked with bullets', () => {
    expect(isMaskedApiTokenKey('sk-abc••••mnop')).toBe(true);
  });

  it('returns false for a clean key', () => {
    expect(isMaskedApiTokenKey('sk-abcdefghijklmnop')).toBe(false);
  });
});

describe('hasUsableApiTokenKey', () => {
  it('is true for a non-empty unmasked key', () => {
    expect(hasUsableApiTokenKey('sk-abcdefghijklmnop')).toBe(true);
  });

  it('is false for a masked key', () => {
    expect(hasUsableApiTokenKey('sk-abc****mnop')).toBe(false);
  });

  it('is false for an empty key', () => {
    expect(hasUsableApiTokenKey('')).toBe(false);
    expect(hasUsableApiTokenKey('   ')).toBe(false);
  });
});

describe('parseTokenSecretKey', () => {
  it('parses the top-level {key} shape', () => {
    const body = JSON.stringify({ success: true, key: 'sk-fullsecret1234' });
    expect(parseTokenSecretKey(body)).toBe('sk-fullsecret1234');
  });

  it('parses the {data:{key}} shape', () => {
    const body = JSON.stringify({ success: true, data: { key: 'sk-nestedsecret99' } });
    expect(parseTokenSecretKey(body)).toBe('sk-nestedsecret99');
  });

  it('parses the {data:"sk-..."} shape', () => {
    const body = JSON.stringify({ success: true, data: 'sk-stringsecret77' });
    expect(parseTokenSecretKey(body)).toBe('sk-stringsecret77');
  });

  it('returns null when the resolved key is still masked', () => {
    const body = JSON.stringify({ success: true, key: 'sk-abc****mnop' });
    expect(parseTokenSecretKey(body)).toBeNull();
  });

  it('returns null for success:false or unavailable body', () => {
    expect(parseTokenSecretKey(JSON.stringify({ success: false }))).toBeNull();
    expect(parseTokenSecretKey('')).toBeNull();
    expect(parseTokenSecretKey('<html></html>')).toBeNull();
  });
});
