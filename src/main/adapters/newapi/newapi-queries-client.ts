import { getAccountPartition } from '../../auth/account-partition';
import type { SessionRequestClient } from '../session-request-client';
import { buildNewApiUserHeaders } from './newapi-auth-context';
import {
  BalanceSnapshot,
  ProfileSnapshot,
  UsageSnapshot,
  parseNewApiBalance,
  parseNewApiProfile,
  parseNewApiUsage,
} from './queries';

/**
 * NewAPI 已知用户态接口相对路径。返回当前登录用户资料/额度/用量的稳定接口。
 * 仅发单次带凭据 GET，不写操作、不扫描多路径。
 */
const NEWAPI_SELF_ENDPOINT = '/api/user/self';

/**
 * 单次查询结果。各项解析失败为 null（表示"本项不可用"），
 * 由上层保留最近成功快照，绝不伪造 0。
 */
export interface NewApiQueryResult {
  profile: ProfileSnapshot | null;
  balance: BalanceSnapshot | null;
  usage: UsageSnapshot | null;
}

export interface NewApiQueriesRequest {
  accountId: string;
  baseUrl: string;
  /** NewAPI 站内数字用户 ID（New-Api-User 头必需）。 */
  siteUserId: string;
}

export interface NewApiQueriesClientDependencies {
  sessionClient: SessionRequestClient;
  /** 可覆盖用户态接口路径（便于实例差异或测试）。 */
  userEndpointPath?: string;
}

/**
 * NewAPI 用户侧信息查询客户端（一期真实实现）。
 *
 * 在账户专属 partition 内对已知用户态接口发单次带凭据 GET，
 * 用纯函数解析资料/余额/用量。解析失败为 null，绝不伪造 0；
 * 网络/请求异常向上抛出，交由 RefreshService 记 error 且不覆盖旧快照。
 */
export class NewApiQueriesClient {
  private readonly sessionClient: SessionRequestClient;
  private readonly userEndpointPath: string;

  constructor(dependencies: NewApiQueriesClientDependencies) {
    this.sessionClient = dependencies.sessionClient;
    this.userEndpointPath = dependencies.userEndpointPath ?? NEWAPI_SELF_ENDPOINT;
  }

  async query(request: NewApiQueriesRequest): Promise<NewApiQueryResult> {
    const url = new URL(this.userEndpointPath, request.baseUrl).toString();
    const partition = getAccountPartition(request.accountId);

    const response = await this.sessionClient.fetchWithSession(url, {
      partition,
      headers: buildNewApiUserHeaders(request.siteUserId),
    });
    const { bodyText } = response;

    return {
      profile: parseNewApiProfile(bodyText),
      balance: parseNewApiBalance(bodyText),
      usage: parseNewApiUsage(bodyText),
    };
  }
}
