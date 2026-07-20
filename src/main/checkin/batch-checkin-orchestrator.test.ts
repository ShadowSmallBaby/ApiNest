import { describe, expect, it } from 'vitest';
import { BatchCheckInOrchestrator } from './batch-checkin-orchestrator';

const accountA = '11111111-1111-4111-8111-111111111111';
const accountB = '22222222-2222-4222-8222-222222222222';
const accountC = '33333333-3333-4333-8333-333333333333';

describe('BatchCheckInOrchestrator', () => {
  it('runs the confirmed snapshot sequentially and continues after a failure', async () => {
    const calls: string[] = [];
    const orchestrator = new BatchCheckInOrchestrator({
      checkInService: {
        run: async accountId => {
          calls.push(accountId);
          if (accountId === accountB) {
            throw new Error('request failed');
          }
          return { accountId, result: 'success', message: 'Check-in completed.' };
        },
      },
    });

    const result = await orchestrator.run([accountA, accountB, accountC]);

    expect(calls).toEqual([accountA, accountB, accountC]);
    expect(result).toEqual({
      total: 3,
      results: [
        { accountId: accountA, result: 'success', message: 'Check-in completed.' },
        { accountId: accountB, result: 'failed', message: 'Check-in request failed.' },
        { accountId: accountC, result: 'success', message: 'Check-in completed.' },
      ],
    });
  });

  it('does not start any account after cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const orchestrator = new BatchCheckInOrchestrator({
      checkInService: {
        run: async () => {
          throw new Error('must not be called');
        },
      },
    });

    await expect(orchestrator.run([accountA, accountB], controller.signal)).resolves.toEqual({
      total: 2,
      results: [
        { accountId: accountA, result: 'cancelled', message: 'Check-in was cancelled before it started.' },
        { accountId: accountB, result: 'cancelled', message: 'Check-in was cancelled before it started.' },
      ],
    });
  });

  it('returns an empty result for an empty confirmed snapshot', async () => {
    const orchestrator = new BatchCheckInOrchestrator({
      checkInService: {
        run: async () => {
          throw new Error('must not be called');
        },
      },
    });

    await expect(orchestrator.run([])).resolves.toEqual({ total: 0, results: [] });
  });
});
