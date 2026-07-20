import type { BatchCheckInResult, CheckInResult } from '../../shared/ipc/bridge';
import type { CheckInService } from './checkin-service';

type CheckInServicePort = Pick<CheckInService, 'run'>;

export interface BatchCheckInOrchestratorDependencies {
  checkInService: CheckInServicePort;
}

/**
 * 对启动时的账户 ID 快照顺序执行用户已确认的签到。
 * 单项失败不阻断后续项；AbortSignal 只停止尚未开始的项目，不后台补跑。
 */
export class BatchCheckInOrchestrator {
  constructor(private readonly deps: BatchCheckInOrchestratorDependencies) {}

  async run(accountIds: string[], signal?: AbortSignal): Promise<BatchCheckInResult> {
    const results: CheckInResult[] = [];

    for (let index = 0; index < accountIds.length; index += 1) {
      const accountId = accountIds[index];
      if (signal?.aborted) {
        results.push(...accountIds.slice(index).map(id => ({
          accountId: id,
          result: 'cancelled' as const,
          message: 'Check-in was cancelled before it started.',
        })));
        break;
      }

      try {
        results.push(await this.deps.checkInService.run(accountId));
      } catch {
        results.push({
          accountId,
          result: 'failed',
          message: 'Check-in request failed.',
        });
      }
    }

    return { total: accountIds.length, results };
  }
}
