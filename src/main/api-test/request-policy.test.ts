import {
  enforceTextRequestBody,
  parseCustomBody,
  projectSafeResponseHeaders,
  redactSecret,
  sanitizeCustomHeaders,
} from './request-policy';

describe('sanitizeCustomHeaders', () => {
  it('normalizes allowed headers', () => {
    expect(sanitizeCustomHeaders({ 'X-Trace-Id': 'abc', Accept: 'application/json' })).toEqual({
      'x-trace-id': 'abc', accept: 'application/json',
    });
  });

  it.each(['Authorization', 'Cookie', 'Host', 'Content-Length', 'Proxy-Test', 'Sec-Fetch-Site'])(
    'rejects security-sensitive header %s',
    name => expect(() => sanitizeCustomHeaders({ [name]: 'x' })).toThrow('not allowed'),
  );

  it('rejects header injection', () => {
    expect(() => sanitizeCustomHeaders({ 'x-ok': 'a\r\nCookie: secret' })).toThrow('invalid characters');
  });
});

describe('custom request body policy', () => {
  it('uses null for blank input and parses JSON objects', () => {
    expect(parseCustomBody(' ')).toBeNull();
    expect(parseCustomBody('{"temperature":0.2}')).toEqual({ temperature: 0.2 });
  });

  it('rejects invalid JSON and non-object JSON', () => {
    expect(() => parseCustomBody('{')).toThrow('valid JSON');
    expect(() => parseCustomBody('[]')).toThrow('JSON object');
  });

  it('locks model and existing stream fields to the selected non-stream request', () => {
    expect(enforceTextRequestBody({ model: 'other', stream: true, input: 'x' }, 'selected', true)).toEqual({
      model: 'selected', stream: false, input: 'x',
    });
  });
});

describe('response projection', () => {
  it('redacts an echoed key and returns only safe response headers', () => {
    expect(redactSecret('failed for sk-secret', 'sk-secret')).toBe('failed for [REDACTED]');
    expect(projectSafeResponseHeaders({
      'content-type': 'application/json', 'x-request-id': 'req-1', 'set-cookie': 'secret',
    })).toEqual({ contentType: 'application/json', requestId: 'req-1' });
  });
});
