/**
 * OAuth / 会话请求调试开关（GitHub + LinuxDo 共用）。
 * 默认关闭。排查时可改为 true（会打印完整 URL / 头 / body / Cookie，仅本地调试用）。
 */
export const APINEST_OAUTH_DEBUG = false;

export function oauthDebug(message: string, ...args: unknown[]): void {
  if (!APINEST_OAUTH_DEBUG) {
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`[OAUTH-DEBUG] ${message}`, ...args);
}
