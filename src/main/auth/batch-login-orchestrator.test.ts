import { describe, expect, it } from 'vitest';
import { BatchLoginOrchestrator } from './batch-login-orchestrator';

describe('BatchLoginOrchestrator', () => {
  it('runs logins serially and continues after failures', async () => {
    const calls: string[] = [];
    const orchestrator = new BatchLoginOrchestrator({
      loginFlowService: {
        open: async accountId => {
          calls.push(accountId);
          if (accountId === 'b') {
            throw new Error('boom');
          }
          return {
            accountId,
            mode: 'auto',
            authState: 'active',
            message: 'ok',
          };
        },
      },
    });

    const result = await orchestrator.run(['a', 'b', 'c']);
    expect(calls).toEqual(['a', 'b', 'c']);
    expect(result.total).toBe(3);
    expect(result.results).toEqual([
      { accountId: 'a', authState: 'active', message: 'ok' },
      { accountId: 'b', authState: 'error', message: 'Login request failed.' },
      { accountId: 'c', authState: 'active', message: 'ok' },
    ]);
  });

  it('marks remaining accounts cancelled when aborted mid-run', async () => {
    const controller = new AbortController();
    let count = 0;
    const orchestrator = new BatchLoginOrchestrator({
      loginFlowService: {
        open: async accountId => {
          count += 1;
          if (count === 1) controller.abort();
          return {
            accountId,
            mode: 'auto',
            authState: 'active',
            message: 'ok',
          };
        },
      },
    });

    const result = await orchestrator.run(['a', 'b', 'c'], controller.signal);
    expect(result.results[0]?.authState).toBe('active');
    expect(result.results.slice(1).every(item => item.message.includes('cancelled'))).toBe(true);
  });
});
