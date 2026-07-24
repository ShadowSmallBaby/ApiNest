/**
 * LinuxDo / 会话请求调试开关。
 * 默认关闭；需要排查 OAuth 时改为 true（会打印完整 URL/Cookie/body）。
 */
export const APINEST_OAUTH_DEBUG = false;

export function oauthDebug(message: string, ...args: unknown[]): void {
  if (!APINEST_OAUTH_DEBUG) {
    return;
  }
  // 直接 console，避免 redact 中间层吞字段；同时写 appLogger 文件。
  // eslint-disable-next-line no-console
  console.log(`[OAUTH-DEBUG] ${message}`, ...args);
}
