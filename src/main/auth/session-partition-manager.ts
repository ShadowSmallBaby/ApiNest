import {
  accountIdFromPartition,
  authIdFromPartition,
  getAccountPartition,
  getAuthPartition,
  PROBE_DIRECT_PARTITION,
  PROBE_PROXY_PARTITION,
} from './account-partition';
import type {
  AccountSessionCleaner,
  ElectronSessionLike,
  SessionModuleLike,
} from './session-service';
import { AppError } from '../../shared/ipc/errors';
import type { CompiledProxyConfig } from '../network/network-types';

/**
 * 网络策略解析端口（由 NetworkPolicyResolver 适配）：把资源身份翻译为代理配置。
 */
export interface SessionProxyPolicyPort {
  resolveForAccount(accountId: string): CompiledProxyConfig;
  resolveForAuth(authId: string): CompiledProxyConfig;
  resolveForFlag(useProxy: boolean): CompiledProxyConfig;
}

/**
 * Session 代理屏障端口（由 SessionNetworkConfigurator 适配）：
 * ensure 在首个请求前完成 setProxy(+closeAllConnections)，失败即抛错拦截。
 */
export interface SessionProxyBarrierPort {
  ensure(
    partition: string,
    session: ElectronSessionLike,
    config: CompiledProxyConfig,
  ): Promise<void>;
  invalidate(partition: string): void;
}

/** 网络编排依赖（阶段 6 注入）；缺省时 partition 准备退化为阶段 6 前的直接返回。 */
export interface SessionNetworkOrchestration {
  policy: SessionProxyPolicyPort;
  barrier: SessionProxyBarrierPort;
}

/**
 * 账户专属 Session Partition 管理器。
 *
 * 统一负责：`accountId -> 固定持久 partition` 映射、账户 session 获取与按账户清理。
 * partition 名仅由不可变的 accountId（UUID）派生，绝不掺入 URL、平台或显示名等业务数据，
 * 因此同一 URL 的两个账户始终得到互相隔离的持久 partition。
 *
 * 阶段 6 起额外承担「首个请求前的网络策略屏障」：prepare* 方法在返回可联网 session 前，
 * 先经注入的策略解析 + 代理屏障，确保 opt-in 资源要么按策略配置代理、要么 fail-closed
 * 被拦截，绝不静默直连。未注入 network 编排时行为与阶段 6 前完全一致（便于测试与渐进接线）。
 */
export class SessionPartitionManager implements AccountSessionCleaner {
  constructor(
    private readonly sessionModule: SessionModuleLike,
    private readonly network?: SessionNetworkOrchestration,
  ) {}

  /** 返回该账户固定的持久 partition 名称。 */
  getPartition(accountId: string): string {
    return getAccountPartition(accountId);
  }

  /** 获取该账户专属的持久化 session（Cookie/网页存储/缓存按账户隔离）。 */
  getAccountSession(accountId: string): ElectronSessionLike {
    return this.sessionModule.fromPartition(this.getPartition(accountId));
  }

  /**
   * 获取 auth 身份专属的持久化 session（github/linuxdo 登录一次后 Cookie 落此 partition）。
   * 供 IdP Cookie 同步读取源会话；auth partition 与账户 partition 严格隔离。
   */
  getAuthSession(authId: string): ElectronSessionLike {
    return this.sessionModule.fromPartition(getAuthPartition(authId));
  }

  /** 清理该账户 partition 的网页存储与缓存；严格限定单个账户，不影响其他账户。 */
  async clearAccountSession(accountId: string): Promise<void> {
    const accountSession = this.getAccountSession(accountId);
    await accountSession.clearStorageData();
    await accountSession.clearCache();
  }

  /**
   * 准备账户 partition 并返回可联网 session：先应用其代理策略屏障。
   * fail-closed：屏障失败抛 NETWORK_POLICY_BLOCKED，调用方不得 fetch / 导航 / 建视图。
   */
  async prepareAccountSession(accountId: string): Promise<ElectronSessionLike> {
    const session = this.getAccountSession(accountId);
    if (this.network) {
      const config = this.network.policy.resolveForAccount(accountId);
      await this.network.barrier.ensure(this.getPartition(accountId), session, config);
    }
    return session;
  }

  /** 准备 auth 身份 partition 并返回可联网 session（github/linuxdo 登录窗口用）。 */
  async prepareAuthSession(authId: string): Promise<ElectronSessionLike> {
    const session = this.getAuthSession(authId);
    if (this.network) {
      const config = this.network.policy.resolveForAuth(authId);
      await this.network.barrier.ensure(getAuthPartition(authId), session, config);
    }
    return session;
  }

  /**
   * 准备平台探测用 session：新 Site 尚未落库，直接用表单当前 useProxy 解析策略。
   * 使用与账户/auth 隔离的非持久探测 partition（direct / proxy 各一），探测不污染账户 Cookie。
   */
  async prepareProbeSession(useProxy: boolean): Promise<ElectronSessionLike> {
    const partition = useProxy ? PROBE_PROXY_PARTITION : PROBE_DIRECT_PARTITION;
    const session = this.sessionModule.fromPartition(partition);
    if (this.network) {
      const config = this.network.policy.resolveForFlag(useProxy);
      await this.network.barrier.ensure(partition, session, config);
    }
    return session;
  }

  /**
   * 按 partition 名准备可联网 session（供只知 partition 的调用方，如会话请求客户端 / 浏览器容器）。
   * 依据前缀反推 account / auth 并套用对应策略屏障；未知 partition 抛错（绝不无策略放行）。
   */
  async prepareSessionForPartition(partition: string): Promise<ElectronSessionLike> {
    const accountId = accountIdFromPartition(partition);
    if (accountId !== null) {
      return this.prepareAccountSession(accountId);
    }
    const authId = authIdFromPartition(partition);
    if (authId !== null) {
      return this.prepareAuthSession(authId);
    }
    throw new AppError('INTERNAL_ERROR', 'Cannot prepare an unknown partition kind for networking.');
  }

  /**
   * 使账户 partition 的代理策略失效，下次 prepare 时重新应用。
   * 用于该账户所属 Site 切换 useProxy 或全局 Proxy 模板变更后的热切换。
   */
  invalidateAccount(accountId: string): void {
    this.network?.barrier.invalidate(this.getPartition(accountId));
  }

  /** 使 auth 身份 partition 的代理策略失效，下次 prepare 时重新应用。 */
  invalidateAuth(authId: string): void {
    this.network?.barrier.invalidate(getAuthPartition(authId));
  }
}
