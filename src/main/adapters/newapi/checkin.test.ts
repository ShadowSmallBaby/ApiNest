import { describe, expect, it } from 'vitest';
import { classifyNewApiCheckIn } from './checkin';

describe('classifyNewApiCheckIn', () => {
  it('recognizes only an explicit successful response', () => {
    expect(classifyNewApiCheckIn({ status: 200, bodyText: '{"success":true}' })).toBe('success');
  });

  it('maps an explicit duplicate check-in response', () => {
    expect(classifyNewApiCheckIn({
      status: 200,
      bodyText: '{"success":false,"message":"今日已签到"}',
    })).toBe('already_checked_in');
  });

  it('maps unauthenticated responses without CF signals to session_expired', () => {
    expect(classifyNewApiCheckIn({ status: 401, bodyText: '{}' })).toBe('session_expired');
    expect(classifyNewApiCheckIn({ status: 403, bodyText: '{}' })).toBe('session_expired');
  });

  it('maps Cloudflare challenge responses to challenge_required by headers', () => {
    expect(classifyNewApiCheckIn({
      status: 403,
      bodyText: '<html>blocked</html>',
      headers: { 'cf-mitigated': 'challenge', server: 'cloudflare' },
    })).toBe('challenge_required');

    expect(classifyNewApiCheckIn({
      status: 503,
      bodyText: '',
      headers: { 'cf-ray': 'abc-123', server: 'cloudflare' },
    })).toBe('challenge_required');

    expect(classifyNewApiCheckIn({
      status: 429,
      bodyText: '',
      headers: { server: 'cloudflare' },
    })).toBe('challenge_required');
  });

  it('maps Cloudflare challenge pages to challenge_required by body markers', () => {
    expect(classifyNewApiCheckIn({
      status: 403,
      bodyText: '<title>Just a moment...</title><div id="challenge-platform"></div>',
    })).toBe('challenge_required');

    expect(classifyNewApiCheckIn({
      status: 200,
      bodyText: 'var __cf_chl = true; turnstile.render()',
    })).toBe('challenge_required');
  });

  it('does not treat a plain 403 with no CF markers as challenge_required', () => {
    expect(classifyNewApiCheckIn({
      status: 403,
      bodyText: '{"message":"forbidden"}',
      headers: { 'content-type': 'application/json' },
    })).toBe('session_expired');
  });

  it('never reports success for malformed, unknown, or server-error responses', () => {
    expect(classifyNewApiCheckIn({ status: 200, bodyText: 'not-json' })).toBe('failed');
    expect(classifyNewApiCheckIn({ status: 200, bodyText: '{"data":{}}' })).toBe('failed');
    expect(classifyNewApiCheckIn({ status: 500, bodyText: '{"success":true}' })).toBe('failed');
  });
});
