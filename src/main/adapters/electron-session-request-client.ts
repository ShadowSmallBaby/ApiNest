import { session } from 'electron';
import type { SessionPartitionManager } from '../auth/session-partition-manager';
import {
  DEFAULT_SESSION_TIMEOUT_MS,
  SESSION_BODY_LIMIT,
  SessionRequestClient,
  SessionRequestOptions,
  SessionResponse,
} from './session-request-client';

type PartitionPreparer = Pick<SessionPartitionManager, 'prepareSessionForPartition'>;

export interface ElectronSessionRequestClientDependencies {
  partitionManager: PartitionPreparer;
}

/**
 * 基于账户专属 partition session 的会话请求客户端。
 *
 * 在 `session.fromPartition(partition)` 派生的网络栈内发单次带凭据请求，用于登录态校验
 * 与用户侧查询。阶段 6 起：fetch 前先经 partitionManager 的网络策略屏障，
 * 确保 opt-in 资源要么按策略配置代理、要么 fail-closed 被拦截（抛错、绝不静默直连）。
 * 真实联网部分无法 node 单测，靠 typecheck + 手动验证；分类与编排靠纯函数/替身覆盖。
 */
export class ElectronSessionRequestClient implements SessionRequestClient {
  constructor(private readonly deps: ElectronSessionRequestClientDependencies) {}

  async fetchWithSession(url: string, options: SessionRequestOptions): Promise<SessionResponse> {
    // 首个请求前的网络策略屏障：按 partition 应用代理策略；失败即抛出，不发起 fetch。
    await this.deps.partitionManager.prepareSessionForPartition(options.partition);
    const accountSession = session.fromPartition(options.partition);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS,
    );

    try {
      const response = await accountSession.fetch(url, {
        method: options.method ?? 'GET',
        redirect: options.redirect ?? 'follow',
        // 使用账户 partition 内已持久化的 Cookie 作为凭据来源。
        credentials: 'include',
        // 额外头与请求体由主进程内业务显式提供（密钥 CRUD / API 测试）；
        // 不在此隐式注入任何本应用凭据。
        ...(options.headers ? { headers: options.headers } : {}),
        ...(options.body !== undefined ? { body: options.body } : {}),
        signal: controller.signal,
      });

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });

      const fullText = await response.text();
      const bodyLimit = options.bodyLimit ?? SESSION_BODY_LIMIT;
      const truncated = fullText.length > bodyLimit;
      const bodyText = fullText.slice(0, bodyLimit);

      return { status: response.status, headers, bodyText, truncated };
    } finally {
      clearTimeout(timeout);
    }
  }
}
