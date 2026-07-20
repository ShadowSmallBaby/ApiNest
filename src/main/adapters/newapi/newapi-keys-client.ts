import type { ApiKeyRecord } from '../../../shared/ipc/bridge';
import { AppError } from '../../../shared/ipc/errors';
import { getAccountPartition } from '../../auth/account-partition';
import type { SessionRequestClient } from '../session-request-client';
import { assertProtectedResponseOk, buildNewApiUserHeaders } from './newapi-auth-context';
import {
  extractTokenKey,
  hasUsableApiTokenKey,
  parseNewApiTokens,
  parseTokenSecretKey,
} from './keys';

/**
 * NewAPI 密钥（token）列表接口相对路径。
 * `p` 为页码（从 0 起），`size` 为每页数量；一次性取足够大的一页覆盖常见规模。
 */
const NEWAPI_TOKEN_ENDPOINT = '/api/token/';

/** 单页拉取上限；覆盖绝大多数账户的 token 规模，避免多次翻页复杂度（KISS）。 */
const DEFAULT_PAGE_SIZE = 100;

/**
 * 密钥列表响应体读取上限。token 列表含 key、备注等字段，
 * 上百条可能超过默认 64KB，故显式放宽到 1MB 以免截断致 JSON 解析失败。
 */
const KEYS_BODY_LIMIT = 1024 * 1024;

export interface NewApiKeysRequest {
  accountId: string;
  baseUrl: string;
  /** NewAPI 站内数字用户 ID（New-Api-User 头必需）。 */
  siteUserId: string;
}

export interface NewApiKeysClientDependencies {
  sessionClient: SessionRequestClient;
  /** 可覆盖 token 接口路径（便于实例差异或测试）。 */
  tokenEndpointPath?: string;
  pageSize?: number;
}

/**
 * NewAPI 密钥查询客户端。
 *
 * 在账户专属 partition 内对已知 token 接口发单次带凭据 GET，用纯函数解析为脱敏视图。
 * 红线：
 * - listByAccount 产出的 key 永远脱敏，完整明文只走 reveal 通道，仅当次返回；
 * - 响应结构不可用时抛错，绝不以空列表掩盖失败；
 * - 绝不将明文写入日志、快照或任何持久层。
 */
export class NewApiKeysClient {
  private readonly sessionClient: SessionRequestClient;
  private readonly tokenEndpointPath: string;
  private readonly pageSize: number;

  constructor(dependencies: NewApiKeysClientDependencies) {
    this.sessionClient = dependencies.sessionClient;
    this.tokenEndpointPath = dependencies.tokenEndpointPath ?? NEWAPI_TOKEN_ENDPOINT;
    this.pageSize = dependencies.pageSize ?? DEFAULT_PAGE_SIZE;
  }

  /** 拉取账户密钥列表（脱敏）。响应不可用时抛错。 */
  async listByAccount(request: NewApiKeysRequest): Promise<ApiKeyRecord[]> {
    const bodyText = await this.fetchTokensBody(request);
    const records = parseNewApiTokens(bodyText, request.accountId);
    if (records === null) {
      throw new AppError('UPSTREAM_INVALID_RESPONSE', 'The key list response could not be parsed.');
    }
    return records;
  }

  /**
   * 揭示单个密钥完整明文。
   *
   * 现代 NewAPI 列表接口的 key 中段以 `*` 脱敏，故：
   * 1. 先从列表取该 id 的原始 key，未脱敏（老站点直返完整 key）则直接用；
   * 2. 脱敏则回退调 `/api/token/{id}/key`（POST）取真实明文。
   * 两条路径都拿不到明文时抛错，绝不把脱敏值当明文返回。返回值仅当次使用，绝不落盘。
   */
  async reveal(request: NewApiKeysRequest, tokenId: number): Promise<string> {
    const listBody = await this.fetchTokensBody(request);
    const rawKey = extractTokenKey(listBody, tokenId);
    if (rawKey !== null && hasUsableApiTokenKey(rawKey)) {
      return rawKey;
    }

    const secretKey = await this.fetchTokenSecretKey(request, tokenId);
    if (secretKey === null) {
      throw new AppError('NOT_FOUND', 'The requested key could not be revealed.');
    }
    return secretKey;
  }

  private async fetchTokensBody(request: NewApiKeysRequest): Promise<string> {
    const url = new URL(this.tokenEndpointPath, request.baseUrl);
    url.searchParams.set('p', '0');
    url.searchParams.set('size', String(this.pageSize));
    const partition = getAccountPartition(request.accountId);

    const response = await this.sessionClient.fetchWithSession(url.toString(), {
      partition,
      headers: buildNewApiUserHeaders(request.siteUserId),
      bodyLimit: KEYS_BODY_LIMIT,
    });
    assertProtectedResponseOk(response);
    return response.bodyText;
  }

  /** 调 `/api/token/{id}/key`（POST）取完整明文；解析失败返回 null。 */
  private async fetchTokenSecretKey(
    request: NewApiKeysRequest,
    tokenId: number,
  ): Promise<string | null> {
    const url = new URL(`${this.tokenEndpointPath}${tokenId}/key`, request.baseUrl);
    const partition = getAccountPartition(request.accountId);
    const response = await this.sessionClient.fetchWithSession(url.toString(), {
      partition,
      method: 'POST',
      headers: buildNewApiUserHeaders(request.siteUserId),
      bodyLimit: KEYS_BODY_LIMIT,
    });
    assertProtectedResponseOk(response);
    return parseTokenSecretKey(response.bodyText);
  }
}
