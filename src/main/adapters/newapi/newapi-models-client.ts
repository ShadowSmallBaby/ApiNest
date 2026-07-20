import type { ModelRecord } from '../../../shared/ipc/bridge';
import { AppError } from '../../../shared/ipc/errors';
import { getAccountPartition } from '../../auth/account-partition';
import type { SessionRequestClient } from '../session-request-client';
import { assertProtectedResponseOk, buildNewApiUserHeaders } from './newapi-auth-context';
import { parseAvailableModels, parseNewApiModels } from './models';

/**
 * NewAPI 模型定价接口相对路径（返回全量模型与计费信息）。
 */
const NEWAPI_PRICING_ENDPOINT = '/api/pricing';

/**
 * NewAPI 账户可用模型接口相对路径（返回当前账户可调用的模型 id 列表）。
 */
const NEWAPI_USER_MODELS_ENDPOINT = '/api/user/models';

/**
 * 模型列表响应体读取上限。定价含数百模型的倍率/分组/端点字段，
 * 可能远超默认 64KB，故显式放宽到 4MB 以免截断致 JSON 解析失败。
 */
const MODELS_BODY_LIMIT = 4 * 1024 * 1024;

export interface NewApiModelsRequest {
  accountId: string;
  baseUrl: string;
  /** NewAPI 站内数字用户 ID（/api/user/models 的 New-Api-User 头必需；/api/pricing 公开不需）。 */
  siteUserId: string;
}

export interface NewApiModelsClientDependencies {
  sessionClient: SessionRequestClient;
  /** 可覆盖定价接口路径（便于实例差异或测试）。 */
  pricingEndpointPath?: string;
  /** 可覆盖账户可用模型接口路径（便于实例差异或测试）。 */
  userModelsEndpointPath?: string;
}

/**
 * NewAPI 模型查询客户端。
 *
 * 在账户专属 partition 内并行拉取定价（全量模型+计费）与账户可用模型集合，
 * 用纯函数解析并取交集，标注每个模型是否对当前账户可用。
 * 红线：
 * - 定价响应结构不可用时抛错，绝不以空列表掩盖失败；
 * - 账户可用模型集合拉取失败（网络/结构不可用）时，保守视为"集合不可用"，
 *   所有模型 availableForAccount 置 false，绝不默认全部可用；
 * - 绝不臆造模型或计费数据。
 */
export class NewApiModelsClient {
  private readonly sessionClient: SessionRequestClient;
  private readonly pricingEndpointPath: string;
  private readonly userModelsEndpointPath: string;

  constructor(dependencies: NewApiModelsClientDependencies) {
    this.sessionClient = dependencies.sessionClient;
    this.pricingEndpointPath = dependencies.pricingEndpointPath ?? NEWAPI_PRICING_ENDPOINT;
    this.userModelsEndpointPath =
      dependencies.userModelsEndpointPath ?? NEWAPI_USER_MODELS_ENDPOINT;
  }

  /** 拉取账户模型列表（含计费与账户可用标注）。定价响应不可用时抛错。 */
  async listByAccount(request: NewApiModelsRequest): Promise<ModelRecord[]> {
    const partition = getAccountPartition(request.accountId);
    const userHeaders = buildNewApiUserHeaders(request.siteUserId);

    // 并行拉取定价（公开，无需用户头）与账户可用模型（受保护，注入用户头）；
    // 账户可用模型失败不阻断定价展示（保守置不可用）。
    const [pricingBody, availableModels] = await Promise.all([
      this.fetchBody(this.pricingEndpointPath, request.baseUrl, partition),
      this.fetchAvailableModels(request.baseUrl, partition, userHeaders),
    ]);

    const records = parseNewApiModels(pricingBody, availableModels);
    if (records === null) {
      throw new AppError('UPSTREAM_INVALID_RESPONSE', 'The model pricing response could not be parsed.');
    }
    return records;
  }

  /**
   * 拉取账户可用模型集合。任何失败（网络异常或结构不可用）都返回 null，
   * 由解析层据 null 将所有模型保守标注为账户不可用，绝不默认全部可用。
   */
  private async fetchAvailableModels(
    baseUrl: string,
    partition: string,
    headers: Record<string, string>,
  ): Promise<Set<string> | null> {
    try {
      const body = await this.fetchBody(this.userModelsEndpointPath, baseUrl, partition, headers);
      return parseAvailableModels(body);
    } catch {
      return null;
    }
  }

  private async fetchBody(
    endpointPath: string,
    baseUrl: string,
    partition: string,
    headers?: Record<string, string>,
  ): Promise<string> {
    const url = new URL(endpointPath, baseUrl).toString();
    const response = await this.sessionClient.fetchWithSession(url, {
      partition,
      ...(headers ? { headers } : {}),
      bodyLimit: MODELS_BODY_LIMIT,
    });
    assertProtectedResponseOk(response);
    return response.bodyText;
  }
}
