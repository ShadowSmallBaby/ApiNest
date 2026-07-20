import { performance } from 'node:perf_hooks';
import type { RunTextApiTestInput, TextApiTestResult } from '../../shared/ipc/bridge';
import { AppError } from '../../shared/ipc/errors';
import { getAccountPartition } from '../auth/account-partition';
import type { SessionRequestClient } from '../adapters/session-request-client';
import type { AccountRepository } from '../storage/repositories/account-repository';
import type { KeysService } from '../keys/keys-service';
import type { ModelsService } from '../models/models-service';
import { resolveTextEndpoint } from './text-endpoints';
import {
  enforceTextRequestBody,
  parseCustomBody,
  projectSafeResponseHeaders,
  redactSecret,
  sanitizeCustomHeaders,
} from './request-policy';

const API_TEST_TIMEOUT_MS = 60_000;
const API_TEST_BODY_LIMIT = 2 * 1024 * 1024;

type AccountRepositoryPort = Pick<AccountRepository, 'get'>;
type KeysServicePort = Pick<KeysService, 'reveal'>;
type ModelsServicePort = Pick<ModelsService, 'listByAccount'>;

export interface TextApiTestServiceDependencies {
  accountRepository: AccountRepositoryPort;
  keysService: KeysServicePort;
  modelsService: ModelsServicePort;
  sessionClient: SessionRequestClient;
  now?: () => number;
}

/** 主进程文本 API 测试编排；密钥明文仅存在于 run 的局部变量中。 */
export class TextApiTestService {
  private readonly accountRepository: AccountRepositoryPort;
  private readonly keysService: KeysServicePort;
  private readonly modelsService: ModelsServicePort;
  private readonly sessionClient: SessionRequestClient;
  private readonly now: () => number;

  constructor(dependencies: TextApiTestServiceDependencies) {
    this.accountRepository = dependencies.accountRepository;
    this.keysService = dependencies.keysService;
    this.modelsService = dependencies.modelsService;
    this.sessionClient = dependencies.sessionClient;
    this.now = dependencies.now ?? (() => performance.now());
  }

  async run(input: RunTextApiTestInput): Promise<TextApiTestResult> {
    const account = this.accountRepository.get(input.accountId);
    if (!account) throw new AppError('ACCOUNT_NOT_FOUND', 'Account was not found.');
    if (account.platform !== 'newapi') {
      throw new AppError('NOT_IMPLEMENTED', 'API testing is only available for NewAPI sites.');
    }

    const models = await this.modelsService.listByAccount(input.accountId);
    const model = models.find(item => item.modelName === input.modelId && item.availableForAccount);
    if (!model) throw new AppError('INVALID_ARGUMENT', 'Selected model is not available for this account.');

    const customHeaders = sanitizeCustomHeaders(input.customHeaders);
    const customBody = parseCustomBody(input.customBodyJson);
    const message = input.message?.trim() ?? '';
    if (customBody === null && message.length === 0) {
      throw new AppError('INVALID_ARGUMENT', 'A test message or custom request body is required.');
    }

    // 明文只在主进程局部变量中短暂存在；不写日志、快照、错误 details 或返回值。
    const apiKey = await this.keysService.reveal(input.accountId, input.tokenId);
    if (!apiKey.trim()) throw new AppError('INVALID_ARGUMENT', 'Selected API key is not available.');

    const endpoint = resolveTextEndpoint(
      account.baseUrl,
      input.endpoint,
      input.modelId,
      message,
      apiKey,
    );
    const modelInBody = input.endpoint !== 'google_generate_content';
    const body = customBody === null
      ? endpoint.body
      : enforceTextRequestBody(customBody, input.modelId, modelInBody);
    const headers = {
      ...customHeaders,
      ...endpoint.authHeaders,
      'content-type': 'application/json',
      accept: 'application/json',
    };

    const startedAt = this.now();
    const response = await this.sessionClient.fetchWithSession(endpoint.url, {
      partition: getAccountPartition(input.accountId),
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      bodyLimit: API_TEST_BODY_LIMIT,
      timeoutMs: API_TEST_TIMEOUT_MS,
      redirect: 'manual',
    });
    const safeHeaders = projectSafeResponseHeaders(response.headers);
    return {
      accountId: input.accountId,
      tokenId: input.tokenId,
      modelId: input.modelId,
      endpoint: input.endpoint,
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      latencyMs: Math.max(0, Math.round(this.now() - startedAt)),
      ...safeHeaders,
      bodyText: redactSecret(response.bodyText, apiKey),
      truncated: response.truncated ?? false,
    };
  }
}
