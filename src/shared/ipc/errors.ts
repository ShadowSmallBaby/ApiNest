export type AppErrorCode =
  | 'INVALID_ARGUMENT'
  | 'UNAUTHORIZED'
  | 'ACCOUNT_NOT_FOUND'
  | 'NOT_FOUND'
  | 'LOCKED'
  | 'NOT_IMPLEMENTED'
  // 账户缺少 NewAPI 站内用户 ID：需打开应用内登录同步认证信息。
  | 'AUTH_METADATA_REQUIRED'
  // 远端会话过期（401）。
  | 'SESSION_EXPIRED'
  // 远端拒绝访问（403）。
  | 'UPSTREAM_FORBIDDEN'
  // 远端不可用（网络失败/超时/5xx）。
  | 'UPSTREAM_UNAVAILABLE'
  // 远端返回结构不可解析（含被登录页 HTML 顶替、响应截断）。
  | 'UPSTREAM_INVALID_RESPONSE'
  // 网络策略（Secure DNS / Proxy）应用失败：opt-in 资源 fail-closed，禁止静默直连。
  | 'NETWORK_POLICY_BLOCKED'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export interface SerializedAppError {
  code: AppErrorCode;
  message: string;
}
