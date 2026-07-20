import { AppError } from '../../../shared/ipc/errors';
import type { SessionResponse } from '../session-request-client';
import {
  assertProtectedResponseOk,
  buildNewApiUserHeaders,
  requireSiteUserId,
} from './newapi-auth-context';

function res(status: number, truncated = false): SessionResponse {
  return { status, headers: {}, bodyText: '', truncated };
}

function expectAppErrorCode(fn: () => void, code: string): void {
  try {
    fn();
    throw new Error('expected the call to throw');
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
  }
}

describe('buildNewApiUserHeaders', () => {
  it('builds the New-Api-User header', () => {
    expect(buildNewApiUserHeaders('42')).toEqual({ 'New-Api-User': '42' });
  });
});

describe('requireSiteUserId', () => {
  it('returns the id when present', () => {
    expect(requireSiteUserId({ getSiteUserId: () => '42' }, 'acc')).toBe('42');
  });

  it('throws AUTH_METADATA_REQUIRED when the id is missing', () => {
    expectAppErrorCode(() => requireSiteUserId({ getSiteUserId: () => null }, 'acc'), 'AUTH_METADATA_REQUIRED');
  });
});

describe('assertProtectedResponseOk', () => {
  it('passes for a 2xx non-truncated response', () => {
    expect(() => assertProtectedResponseOk(res(200))).not.toThrow();
    expect(() => assertProtectedResponseOk(res(204))).not.toThrow();
  });

  it('maps 401 to SESSION_EXPIRED', () => {
    expectAppErrorCode(() => assertProtectedResponseOk(res(401)), 'SESSION_EXPIRED');
  });

  it('maps 403 to UPSTREAM_FORBIDDEN', () => {
    expectAppErrorCode(() => assertProtectedResponseOk(res(403)), 'UPSTREAM_FORBIDDEN');
  });

  it('maps 5xx and other non-2xx to UPSTREAM_UNAVAILABLE', () => {
    expectAppErrorCode(() => assertProtectedResponseOk(res(500)), 'UPSTREAM_UNAVAILABLE');
    expectAppErrorCode(() => assertProtectedResponseOk(res(302)), 'UPSTREAM_UNAVAILABLE');
  });

  it('maps a truncated 2xx body to UPSTREAM_INVALID_RESPONSE', () => {
    expectAppErrorCode(() => assertProtectedResponseOk(res(200, true)), 'UPSTREAM_INVALID_RESPONSE');
  });
});
