import type { ProbeResponse } from '../probe-client';
import { detectNewApiFeatures } from './detect';

function makeResponse(overrides: Partial<ProbeResponse> = {}): ProbeResponse {
  return {
    status: 200,
    headers: {},
    bodyText: '',
    ...overrides,
  };
}

describe('detectNewApiFeatures', () => {
  it('returns high confidence for a known page marker', () => {
    const result = detectNewApiFeatures(
      makeResponse({ bodyText: '<title>New-API Console</title>' }),
    );
    expect(result.confidence).toBe('high');
  });

  it('returns high confidence for a known server header', () => {
    const result = detectNewApiFeatures(
      makeResponse({ headers: { server: 'one-api/1.0' }, bodyText: 'anything' }),
    );
    expect(result.confidence).toBe('high');
  });

  it('returns low confidence for only generic markers', () => {
    const result = detectNewApiFeatures(
      makeResponse({ bodyText: 'Manage your api token and quota here.' }),
    );
    expect(result.confidence).toBe('low');
  });

  it('returns unknown for non-success status', () => {
    expect(detectNewApiFeatures(makeResponse({ status: 502, bodyText: 'new-api' })).confidence).toBe(
      'unknown',
    );
  });

  it('returns unknown for empty body', () => {
    expect(detectNewApiFeatures(makeResponse({ bodyText: '   ' })).confidence).toBe('unknown');
  });

  it('returns unknown when no features match', () => {
    expect(detectNewApiFeatures(makeResponse({ bodyText: 'Welcome to my blog.' })).confidence).toBe(
      'unknown',
    );
  });

  it('never includes raw body content in the reason', () => {
    const secret = 'SENSITIVE-COOKIE-VALUE';
    const result = detectNewApiFeatures(makeResponse({ bodyText: `hello ${secret}` }));
    expect(result.reason).not.toContain(secret);
  });
});
