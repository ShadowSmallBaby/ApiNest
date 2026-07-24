import type { BatchLoginResult, LoginResult } from '../../shared/ipc/bridge';
import type { LoginFlowService } from './login-flow-service';

type LoginFlowPort = Pick<LoginFlowService, 'open'>;

export interface BatchLoginOrchestratorDependencies {
  loginFlowService: LoginFlowPort;
}

/**
 * 对启动时的账户 ID 快照顺序执行用户已确认的一键登录。
 * 单项失败不阻断后续项；AbortSignal 只停止尚未开始的项目。
 */
export class BatchLoginOrchestrator {
  constructor(private readonly deps: BatchLoginOrchestratorDependencies) {}

  async run(accountIds: string[], signal?: AbortSignal): Promise<BatchLoginResult> {
    const results: BatchLoginResult['results'] = [];

    for (let index = 0; index < accountIds.length; index += 1) {
      const accountId = accountIds[index];
      if (signal?.aborted) {
        results.push(
          ...accountIds.slice(index).map(id => ({
            accountId: id,
            authState: 'unknown' as const,
            message: 'Login was cancelled before it started.',
          })),
        );
        break;
      }

      try {
        const result: LoginResult = await this.deps.loginFlowService.open(accountId, 'auto');
        results.push({
          accountId,
          authState: result.authState,
          message: result.message,
        });
      } catch {
        results.push({
          accountId,
          authState: 'error',
          message: 'Login request failed.',
        });
      }
    }

    return { total: accountIds.length, results };
  }
}
