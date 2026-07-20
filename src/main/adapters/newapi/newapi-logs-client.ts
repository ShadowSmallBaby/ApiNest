import type { UsageLogPage, UsageLogQuery } from '../../../shared/ipc/bridge';
import { AppError } from '../../../shared/ipc/errors';
import { getAccountPartition } from '../../auth/account-partition';
import type { SessionRequestClient } from '../session-request-client';
import { assertProtectedResponseOk, buildNewApiUserHeaders } from './newapi-auth-context';
import { parseNewApiUsageLogs } from './logs';

const NEWAPI_LOGS_ENDPOINT = '/api/log/self';

/** 日志页每页最多 100 条，响应体上限 2MB，避免截断同时约束内存占用。 */
const LOGS_BODY_LIMIT = 2 * 1024 * 1024;

export interface NewApiLogsRequest {
  accountId: string;
  baseUrl: string;
  /** NewAPI 站内数字用户 ID（New-Api-User 头必需）。 */
  siteUserId: string;
  query: UsageLogQuery;
}

export interface NewApiLogsClientDependencies {
  sessionClient: SessionRequestClient;
  /** 仅供后端实例兼容与测试覆盖，Renderer 无法控制。 */
  endpointPath?: string;
}

/** NewAPI 日志查询客户端；固定请求 /api/log/self 并绑定账户专属 partition。 */
export class NewApiLogsClient {
  private readonly sessionClient: SessionRequestClient;
  private readonly endpointPath: string;

  constructor(dependencies: NewApiLogsClientDependencies) {
    this.sessionClient = dependencies.sessionClient;
    this.endpointPath = dependencies.endpointPath ?? NEWAPI_LOGS_ENDPOINT;
  }

  async listByAccount(request: NewApiLogsRequest): Promise<UsageLogPage> {
    const url = this.buildUrl(request.baseUrl, request.query);
    const response = await this.sessionClient.fetchWithSession(url, {
      partition: getAccountPartition(request.accountId),
      headers: buildNewApiUserHeaders(request.siteUserId),
      bodyLimit: LOGS_BODY_LIMIT,
    });
    assertProtectedResponseOk(response);
    const result = parseNewApiUsageLogs(
      response.bodyText,
      request.accountId,
      request.query.page,
      request.query.pageSize,
    );
    if (result === null) {
      throw new AppError('UPSTREAM_INVALID_RESPONSE', 'The usage log response could not be parsed.');
    }
    return result;
  }

  private buildUrl(baseUrl: string, query: UsageLogQuery): string {
    const url = new URL(this.endpointPath, baseUrl);
    url.searchParams.set('p', String(query.page));
    url.searchParams.set('page_size', String(query.pageSize));
    if (query.type !== undefined) url.searchParams.set('type', String(query.type));
    if (query.tokenName) url.searchParams.set('token_name', query.tokenName);
    if (query.modelName) url.searchParams.set('model_name', query.modelName);
    if (query.startTimestamp !== undefined) {
      url.searchParams.set('start_timestamp', String(query.startTimestamp));
    }
    if (query.endTimestamp !== undefined) {
      url.searchParams.set('end_timestamp', String(query.endTimestamp));
    }
    return url.toString();
  }
}
