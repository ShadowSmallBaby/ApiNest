import { getAccountPartition } from '../../auth/account-partition';
import type {
  SessionValidationOutcome,
  SessionValidationRequest,
  SessionValidator,
} from '../../auth/session-validator';
import type { SessionRequestClient } from '../session-request-client';
import { buildNewApiUserHeaders } from './newapi-auth-context';
import { classifyNewApiSession } from './session';

/**
 * NewAPI 已知用户态接口相对路径。
 *
 * 用于登录态校验：返回当前登录用户身份的稳定接口。
 * 仅发单次带凭据 GET，不写操作、不扫描多路径。
 */
const NEWAPI_SELF_ENDPOINT = '/api/user/self';

export interface NewApiSessionValidatorDependencies {
  sessionClient: SessionRequestClient;
  /** 可覆盖用户态接口路径（便于实例差异或测试）。 */
  userEndpointPath?: string;
}

/**
 * NewAPI 会话校验器（一期真实实现）。
 *
 * 在账户专属 partition 内对已知用户态接口发单次带凭据 GET，
 * 据 HTTP 状态/响应结构判定 active/expired/unknown/error。
 * 绝不以余额/空数据推断成功；网络异常记为 error 而非伪造业务成功。
 */
export class NewApiSessionValidator implements SessionValidator {
  private readonly sessionClient: SessionRequestClient;
  private readonly userEndpointPath: string;

  constructor(dependencies: NewApiSessionValidatorDependencies) {
    this.sessionClient = dependencies.sessionClient;
    this.userEndpointPath = dependencies.userEndpointPath ?? NEWAPI_SELF_ENDPOINT;
  }

  async validate(request: SessionValidationRequest): Promise<SessionValidationOutcome> {
    let url: string;
    try {
      url = new URL(this.userEndpointPath, request.baseUrl).toString();
    } catch {
      return { state: 'unknown' };
    }

    // 缺少站内用户 ID：上游 UserAuth 必然 401，直接判过期，避免无谓请求与误报 error。
    if (!request.siteUserId) {
      return { state: 'expired' };
    }

    const partition = getAccountPartition(request.accountId);

    try {
      const response = await this.sessionClient.fetchWithSession(url, {
        partition,
        headers: buildNewApiUserHeaders(request.siteUserId),
      });
      return classifyNewApiSession({
        status: response.status,
        bodyText: response.bodyText,
      });
    } catch {
      // 网络层异常：记为 error，绝不伪造为可用。错误摘要脱敏，不含 URL/响应体。
      return {
        state: 'error',
        errorCode: 'NETWORK_ERROR',
        errorSummary: 'Session validation request failed.',
      };
    }
  }
}
