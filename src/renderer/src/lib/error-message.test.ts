import { getSafeErrorMessage, isReloginError, parseAppError } from './error-message';

const wrap = (inner: string): { message: string } => ({
  message: `Error occurred in handler for 'keys:list-by-account': ${inner}`,
});

describe('parseAppError', () => {
  it('strips the electron handler prefix and extracts inner code/message', () => {
    const error = wrap("{ code: 'AUTH_METADATA_REQUIRED', message: '需要登录' }");
    expect(parseAppError(error)).toEqual({ code: 'AUTH_METADATA_REQUIRED', message: '需要登录' });
  });

  it('returns plain messages unchanged (no prefix, no inner object)', () => {
    expect(parseAppError({ message: '普通错误' })).toEqual({ code: undefined, message: '普通错误' });
  });

  it('falls back to a generic message for non-error values', () => {
    expect(parseAppError(null)).toEqual({ message: '操作失败，请稍后重试。' });
    expect(parseAppError(42)).toEqual({ message: '操作失败，请稍后重试。' });
  });

  it('unescapes single quotes inside the inspected message', () => {
    const error = wrap("{ code: 'NOT_FOUND', message: 'it\\'s gone' }");
    expect(parseAppError(error).message).toBe("it's gone");
  });
});

describe('isReloginError', () => {
  it('is true for auth-metadata and session-expired codes', () => {
    expect(isReloginError(wrap("{ code: 'AUTH_METADATA_REQUIRED', message: 'x' }"))).toBe(true);
    expect(isReloginError(wrap("{ code: 'SESSION_EXPIRED', message: 'x' }"))).toBe(true);
  });

  it('is false for other codes', () => {
    expect(isReloginError(wrap("{ code: 'NOT_FOUND', message: 'x' }"))).toBe(false);
    expect(isReloginError({ message: '普通错误' })).toBe(false);
  });
});

describe('getSafeErrorMessage', () => {
  it('returns the parsed inner message for unknown codes', () => {
    expect(getSafeErrorMessage(wrap("{ code: 'X', message: 'hi' }"))).toBe('hi');
  });

  it('localizes known error codes to Chinese regardless of the English backend message', () => {
    expect(getSafeErrorMessage(wrap("{ code: 'AUTH_METADATA_REQUIRED', message: 'English backend msg' }"))).toContain('应用内登录');
    expect(getSafeErrorMessage(wrap("{ code: 'SESSION_EXPIRED', message: 'English backend msg' }"))).toContain('登录状态已过期');
  });
});
