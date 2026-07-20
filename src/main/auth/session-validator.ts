import type { PlatformType } from '../../shared/ipc/bridge';

export interface SessionValidationRequest {
  accountId: string;
  baseUrl: string;
  platform: PlatformType;
  /** NewAPI 站内数字用户 ID（New-Api-User 头必需）；缺失时校验直接判过期。 */
  siteUserId?: string;
}

export type SessionValidationOutcome =
  | { state: 'active' | 'expired' | 'unknown' }
  | { state: 'error'; errorCode: string; errorSummary: string };

/**
 * 站点会话校验端口。
 *
 * 一期 NewAPI 的真实实现由 5.3 提供；上层编排只依赖此接口，
 * 便于注入替身，也避免 4.3 倒挂 5.x 适配器。
 */
export interface SessionValidator {
  validate(request: SessionValidationRequest): Promise<SessionValidationOutcome>;
}

/**
 * 占位实现：在真实适配器接入前恒返回 `unknown`。
 * 绝不以业务值或空数据伪造 `active`。
 */
export class UnknownSessionValidator implements SessionValidator {
  async validate(): Promise<SessionValidationOutcome> {
    return { state: 'unknown' };
  }
}
