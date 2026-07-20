import { normalizeSiteUserId, pickSiteUserId } from './newapi-site-identity';

describe('normalizeSiteUserId', () => {
  it('accepts positive integers and integer strings (trimmed)', () => {
    expect(normalizeSiteUserId(42)).toBe('42');
    expect(normalizeSiteUserId('42')).toBe('42');
    expect(normalizeSiteUserId('  42  ')).toBe('42');
    expect(normalizeSiteUserId(1)).toBe('1');
  });

  it('rejects zero, negatives, decimals, non-numeric, empty and nullish', () => {
    expect(normalizeSiteUserId(0)).toBeNull();
    expect(normalizeSiteUserId('0')).toBeNull();
    expect(normalizeSiteUserId(-1)).toBeNull();
    expect(normalizeSiteUserId('-1')).toBeNull();
    expect(normalizeSiteUserId(1.5)).toBeNull();
    expect(normalizeSiteUserId('1.5')).toBeNull();
    expect(normalizeSiteUserId('1e3')).toBeNull();
    expect(normalizeSiteUserId('abc')).toBeNull();
    expect(normalizeSiteUserId('')).toBeNull();
    expect(normalizeSiteUserId('   ')).toBeNull();
    expect(normalizeSiteUserId(null)).toBeNull();
    expect(normalizeSiteUserId(undefined)).toBeNull();
    expect(normalizeSiteUserId({})).toBeNull();
  });

  it('rejects integers beyond the safe range', () => {
    expect(normalizeSiteUserId(Number.MAX_SAFE_INTEGER + 1)).toBeNull();
    // 9007199254740993 > Number.MAX_SAFE_INTEGER, loses precision when parsed.
    expect(normalizeSiteUserId('9007199254740993')).toBeNull();
  });
});

describe('pickSiteUserId', () => {
  it('uses uid when only uid is present (default UI)', () => {
    expect(pickSiteUserId({ uid: '42', userJson: null })).toEqual({ userId: '42', conflict: false });
  });

  it('uses user.id from classic JSON when only user is present', () => {
    expect(pickSiteUserId({ uid: null, userJson: JSON.stringify({ id: 7, username: 'x' }) })).toEqual({
      userId: '7',
      conflict: false,
    });
  });

  it('accepts matching uid and user.id', () => {
    expect(pickSiteUserId({ uid: '5', userJson: JSON.stringify({ id: 5 }) })).toEqual({
      userId: '5',
      conflict: false,
    });
  });

  it('flags a conflict when uid and user.id differ', () => {
    expect(pickSiteUserId({ uid: '5', userJson: JSON.stringify({ id: 9 }) })).toEqual({
      userId: null,
      conflict: true,
    });
  });

  it('ignores invalid user JSON but still uses a valid uid', () => {
    expect(pickSiteUserId({ uid: '5', userJson: 'not json' })).toEqual({ userId: '5', conflict: false });
    expect(pickSiteUserId({ uid: null, userJson: '{bad' })).toEqual({ userId: null, conflict: false });
  });

  it('returns null when neither candidate is valid', () => {
    expect(pickSiteUserId({ uid: '0', userJson: null })).toEqual({ userId: null, conflict: false });
    expect(pickSiteUserId({ uid: null, userJson: null })).toEqual({ userId: null, conflict: false });
  });

  it('never reads access_token from the user payload', () => {
    const result = pickSiteUserId({
      uid: null,
      userJson: JSON.stringify({ id: 3, access_token: 'sk-secret' }),
    });
    expect(result).toEqual({ userId: '3', conflict: false });
  });
});
