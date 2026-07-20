import { session } from 'electron';
import { PROBE_DIRECT_PARTITION, PROBE_PROXY_PARTITION } from '../auth/account-partition';
import type { SessionPartitionManager } from '../auth/session-partition-manager';
import {
  DEFAULT_PROBE_TIMEOUT_MS,
  PROBE_BODY_LIMIT,
  ProbeClient,
  ProbeRequestOptions,
  ProbeResponse,
} from './probe-client';

type ProbePreparer = Pick<SessionPartitionManager, 'prepareProbeSession'>;

export interface ElectronProbeClientDependencies {
  partitionManager: ProbePreparer;
}

/**
 * 基于隔离探测 partition 的探测客户端。
 *
 * 仅对目标 baseUrl 发一次轻量 GET 用于平台识别：不带凭据、不发敏感头、短超时、
 * 单路径、响应体截断。阶段 6 起不再用默认 `net.fetch`，而是先经 partitionManager 的
 * 探测屏障（direct / proxy 各一的非持久 partition），使新 Site 的探测也能按表单 useProxy
 * 走既定网络策略；屏障失败即 fail-closed（抛错、不 fetch）。真实联网靠 typecheck + 手动验证。
 */
export class ElectronProbeClient implements ProbeClient {
  constructor(private readonly deps: ElectronProbeClientDependencies) {}

  async fetchProbe(url: string, options: ProbeRequestOptions = {}): Promise<ProbeResponse> {
    const useProxy = options.useProxy ?? false;
    // 探测前的网络策略屏障：对隔离探测 partition 应用策略；失败即抛出，不发起 fetch。
    await this.deps.partitionManager.prepareProbeSession(useProxy);
    const probeSession = session.fromPartition(
      useProxy ? PROBE_PROXY_PARTITION : PROBE_DIRECT_PARTITION,
    );
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    );

    try {
      const response = await probeSession.fetch(url, {
        method: 'GET',
        redirect: 'follow',
        credentials: 'omit',
        signal: controller.signal,
      });

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });

      const fullText = await response.text();
      const bodyText = fullText.slice(0, PROBE_BODY_LIMIT);

      return { status: response.status, headers, bodyText };
    } finally {
      clearTimeout(timeout);
    }
  }
}
