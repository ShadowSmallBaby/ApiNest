import { AppError } from '../../../shared/ipc/errors';
import type { SessionResponse } from '../session-request-client';

/**
 * NewAPI 账户级认证上下文与请求头构造。
 *
 * 上游契约（QuantumNous/new-api `middleware.UserAuth`，见 middleware/auth.go）：
 * 所有 UserAuth 保护的接口都强制读取请求头 `New-Api-User`（站内数字用户 ID），
 * 并校验其与会话身份一致；仅账户 partition Cookie 不足以通过认证。
 * 因此对 `/api/token/`、`/api/user/self`、`/api/log/self`、`/api/user/models`、
 * `/api/user/checkin` 等受保护请求必须注入该头。ApiNest 目前仅 newapi 平台，
 * 只发送这一头（HTTP 头名大小写不敏感，与上游字面 `New-Api-User` 一致）。
 */

/** 站内用户 ID 读取端口（由 account_auth_state 仓储实现）。 */
export interface SiteUserIdReader {
  getSiteUserId(accountId: string): string | null;
}

/** 构造 NewAPI 受保护请求所需的用户 ID 头。 */
export function buildNewApiUserHeaders(siteUserId: string): Record<string, string> {
  return { 'New-Api-User': siteUserId };
}

/**
 * 解析账户站内用户 ID；缺失时抛 AUTH_METADATA_REQUIRED（在网络调用前拦截）。
 * message 用英文（主进程日志/终端不乱码）；面向用户的中文文案由 renderer 按 code 本地化。
 */
export function requireSiteUserId(reader: SiteUserIdReader, accountId: string): string {
  const siteUserId = reader.getSiteUserId(accountId);
  if (!siteUserId) {
    throw new AppError(
      'AUTH_METADATA_REQUIRED',
      'Account is missing its site user identity; open in-app login to sync.',
    );
  }
  return siteUserId;
}

/**
 * 按 HTTP 状态与截断标志将受保护响应分类；仅 2xx 未截断时返回 null（交由调用方解析正文）。
 * 401→SESSION_EXPIRED、403→UPSTREAM_FORBIDDEN、5xx/其它非 2xx→UPSTREAM_UNAVAILABLE、
 * 截断→UPSTREAM_INVALID_RESPONSE。message 用英文（不乱码）；错误消息不含 URL/正文/头等敏感内容。
 */
export function assertProtectedResponseOk(response: SessionResponse): void {
  const { status } = response;
  if (status === 401) {
    throw new AppError('SESSION_EXPIRED', 'Account session has expired.');
  }
  if (status === 403) {
    throw new AppError('UPSTREAM_FORBIDDEN', 'Account is not allowed to access this resource.');
  }
  if (status < 200 || status >= 300) {
    throw new AppError('UPSTREAM_UNAVAILABLE', 'The site is temporarily unavailable.');
  }
  if (response.truncated) {
    throw new AppError('UPSTREAM_INVALID_RESPONSE', 'The site returned an oversized or incomplete response.');
  }
}
