/**
 * 从 IPC 错误中提取可读消息与错误码。
 *
 * 主进程 serializeError 抛出 `{ code, message }`，Electron ipcMain.handle 会将其包装为
 * `Error occurred in handler for 'channel': { code: 'X', message: 'Y' }`。此处剥离该前缀并
 * 解析内层 code/message，让 UI 展示干净文案并按 code 决定后续动作（如提示重新登录）。
 */

export interface AppErrorInfo {
  code?: string;
  message: string;
}

const HANDLER_PREFIX = /^Error occurred in handler for '[^']*':\s*/;
const INSPECT_CODE = /code:\s*'([^']*)'/;
const INSPECT_MESSAGE = /message:\s*'((?:[^'\\]|\\.)*)'/;

function extractRawMessage(error: unknown): string {
  if (
    typeof error === 'object'
    && error !== null
    && 'message' in error
    && typeof (error as { message?: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }
  return '';
}

/** 还原 util.inspect 单引号字符串中的转义（\' → '，\\ → \）。 */
function unescapeInspect(value: string): string {
  return value.replace(/\\(['\\])/g, '$1');
}

/** 解析 IPC 错误为 { code?, message }；无法解析时回退到通用文案。 */
export function parseAppError(error: unknown): AppErrorInfo {
  const raw = extractRawMessage(error);
  if (!raw) {
    return { message: '操作失败，请稍后重试。' };
  }

  const withoutPrefix = raw.replace(HANDLER_PREFIX, '');
  const code = withoutPrefix.match(INSPECT_CODE)?.[1];
  const messageMatch = withoutPrefix.match(INSPECT_MESSAGE);
  if (messageMatch) {
    return { code, message: unescapeInspect(messageMatch[1]) };
  }

  return { code, message: withoutPrefix || '操作失败，请稍后重试。' };
}

/**
 * 错误码 → 中文用户文案。主进程 AppError 的 message 用英文（终端日志不乱码），
 * renderer 按 code 本地化为中文；未知 code 回退到解析出的原始 message。
 */
const CODE_MESSAGES: Record<string, string> = {
  AUTH_METADATA_REQUIRED: '该账号尚未同步站内用户信息，请打开该账号的「应用内登录」完成一次登录以同步。',
  SESSION_EXPIRED: '账号登录状态已过期，请重新登录。',
  UPSTREAM_FORBIDDEN: '账号无权访问该资源，请检查账号状态或权限。',
  UPSTREAM_UNAVAILABLE: '站点暂时不可用，请稍后重试。',
  UPSTREAM_INVALID_RESPONSE: '站点返回的响应异常，请稍后重试。',
  NOT_FOUND: '未找到请求的资源。',
  ACCOUNT_NOT_FOUND: '账号不存在。',
  NOT_IMPLEMENTED: '该功能对当前站点类型不可用。',
};

/** 提取可读错误消息：优先按 code 本地化中文，未知 code 回退解析出的 message。 */
export function getSafeErrorMessage(error: unknown): string {
  const { code, message } = parseAppError(error);
  if (code && CODE_MESSAGES[code]) {
    return CODE_MESSAGES[code];
  }
  return message;
}

/** 该错误是否因缺少登录/身份信息导致（可引导用户打开应用内登录修复）。 */
export function isReloginError(error: unknown): boolean {
  const { code } = parseAppError(error);
  return code === 'AUTH_METADATA_REQUIRED' || code === 'SESSION_EXPIRED';
}
