import { redactSensitiveData } from './logger';

describe('redactSensitiveData', () => {
  it('redacts sensitive string fragments', () => {
    const input = 'Authorization=Bearer secret-token&code=oauth-secret&token=value';
    const output = redactSensitiveData(input);

    expect(output).not.toContain('secret-token');
    expect(output).not.toContain('oauth-secret');
    expect(output).not.toContain('value');
  });

  it('redacts nested object values by key and content', () => {
    const output = redactSensitiveData({
      cookie: 'foo=bar',
      nested: {
        authorization: 'Bearer xyz',
        safe: 'hello',
      },
      url: 'https://example.com/callback?access_token=abc123',
    });

    expect(output).toEqual({
      cookie: '[REDACTED]',
      nested: {
        authorization: '[REDACTED]',
        safe: 'hello',
      },
      url: 'https://example.com/callback?access_token=[REDACTED]',
    });
  });
});
