import { classifyNewApiSession } from './session';

describe('classifyNewApiSession', () => {
  it('treats 401/403 as expired', () => {
    expect(classifyNewApiSession({ status: 401, bodyText: '' })).toEqual({ state: 'expired' });
    expect(classifyNewApiSession({ status: 403, bodyText: '' })).toEqual({ state: 'expired' });
  });

  it('treats 5xx as error without faking business success', () => {
    const outcome = classifyNewApiSession({ status: 503, bodyText: '' });
    expect(outcome.state).toBe('error');
    if (outcome.state === 'error') {
      expect(outcome.errorCode).toBe('SITE_ERROR');
      expect(outcome.errorSummary).not.toContain('token');
    }
  });

  it('treats 200 with a stable user identity as active', () => {
    const body = JSON.stringify({ success: true, data: { id: 42, username: 'alice' } });
    expect(classifyNewApiSession({ status: 200, bodyText: body })).toEqual({ state: 'active' });
  });

  it('treats 200 with a top-level identity as active', () => {
    const body = JSON.stringify({ id: 7, username: 'bob' });
    expect(classifyNewApiSession({ status: 200, bodyText: body })).toEqual({ state: 'active' });
  });

  it('does NOT infer active from balance or usage values (red line)', () => {
    const body = JSON.stringify({ success: true, data: { quota: 1000, used_quota: 250 } });
    expect(classifyNewApiSession({ status: 200, bodyText: body })).toEqual({ state: 'unknown' });
  });

  it('does NOT infer active from an empty data object (red line)', () => {
    const body = JSON.stringify({ success: true, data: {} });
    expect(classifyNewApiSession({ status: 200, bodyText: body })).toEqual({ state: 'unknown' });
  });

  it('treats success:false as expired', () => {
    const body = JSON.stringify({ success: false, message: 'unauthorized' });
    expect(classifyNewApiSession({ status: 200, bodyText: body })).toEqual({ state: 'expired' });
  });

  it('treats non-JSON body as unknown', () => {
    expect(classifyNewApiSession({ status: 200, bodyText: '<html>login</html>' })).toEqual({
      state: 'unknown',
    });
  });

  it('treats empty body as unknown', () => {
    expect(classifyNewApiSession({ status: 200, bodyText: '' })).toEqual({ state: 'unknown' });
  });

  it('treats a JSON array as unknown (no identity)', () => {
    expect(classifyNewApiSession({ status: 200, bodyText: '[1,2,3]' })).toEqual({ state: 'unknown' });
  });

  it('treats other non-2xx statuses as unknown', () => {
    expect(classifyNewApiSession({ status: 302, bodyText: '' })).toEqual({ state: 'unknown' });
  });
});
