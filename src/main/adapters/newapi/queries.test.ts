import {
  parseNewApiBalance,
  parseNewApiProfile,
  parseNewApiUsage,
} from './queries';

describe('parseNewApiProfile', () => {
  it('parses a valid user identity', () => {
    const body = JSON.stringify({ success: true, data: { id: 42, username: 'alice' } });
    expect(parseNewApiProfile(body)).toEqual({
      username: 'alice',
      source: 'newapi:/api/user/self',
    });
  });

  it('accepts identity at top level', () => {
    const body = JSON.stringify({ id: 7, username: 'bob' });
    expect(parseNewApiProfile(body)).toMatchObject({ username: 'bob' });
  });

  it('returns null when no stable identity field exists', () => {
    const body = JSON.stringify({ success: true, data: { quota: 100 } });
    expect(parseNewApiProfile(body)).toBeNull();
  });

  it('returns null for success:false', () => {
    const body = JSON.stringify({ success: false, message: 'not logged in' });
    expect(parseNewApiProfile(body)).toBeNull();
  });

  it('returns null for non-JSON or empty body', () => {
    expect(parseNewApiProfile('')).toBeNull();
    expect(parseNewApiProfile('<html>login</html>')).toBeNull();
  });
});

describe('parseNewApiBalance', () => {
  it('parses a valid quota', () => {
    const body = JSON.stringify({ success: true, data: { id: 1, quota: 5000 } });
    expect(parseNewApiBalance(body)).toEqual({
      remaining: 5000,
      unit: 'quota',
      source: 'newapi:/api/user/self',
    });
  });

  it('accepts a legitimate zero quota', () => {
    const body = JSON.stringify({ success: true, data: { id: 1, quota: 0 } });
    expect(parseNewApiBalance(body)).toEqual({
      remaining: 0,
      unit: 'quota',
      source: 'newapi:/api/user/self',
    });
  });

  it('returns null when quota is missing (never fabricates 0)', () => {
    const body = JSON.stringify({ success: true, data: { id: 1, username: 'alice' } });
    expect(parseNewApiBalance(body)).toBeNull();
  });

  it('returns null when quota is null / NaN / non-numeric', () => {
    expect(parseNewApiBalance(JSON.stringify({ data: { quota: null } }))).toBeNull();
    expect(parseNewApiBalance(JSON.stringify({ data: { quota: 'lots' } }))).toBeNull();
    // NaN cannot survive JSON round-trip, assert via a NaN-injected object path.
    expect(parseNewApiBalance('{"data":{"quota":NaN}}')).toBeNull();
  });

  it('returns null for success:false', () => {
    expect(parseNewApiBalance(JSON.stringify({ success: false }))).toBeNull();
  });
});

describe('parseNewApiUsage', () => {
  it('parses a valid used_quota', () => {
    const body = JSON.stringify({ success: true, data: { id: 1, used_quota: 1200 } });
    expect(parseNewApiUsage(body)).toEqual({
      used: 1200,
      unit: 'quota',
      source: 'newapi:/api/user/self',
    });
  });

  it('returns null when used_quota is missing (never fabricates 0)', () => {
    const body = JSON.stringify({ success: true, data: { id: 1, quota: 100 } });
    expect(parseNewApiUsage(body)).toBeNull();
  });

  it('returns null when used_quota is non-numeric', () => {
    expect(parseNewApiUsage(JSON.stringify({ data: { used_quota: 'x' } }))).toBeNull();
  });
});
