import type { ElectronSessionLike, SessionModuleLike } from './session-service';
import { SessionPartitionManager } from './session-partition-manager';

function createRecordingSessionModule(): {
  sessionModule: SessionModuleLike;
  partitions: string[];
  callsByPartition: Map<string, string[]>;
} {
  const partitions: string[] = [];
  const callsByPartition = new Map<string, string[]>();

  const sessionModule: SessionModuleLike = {
    fromPartition: partition => {
      partitions.push(partition);
      const calls = callsByPartition.get(partition) ?? [];
      callsByPartition.set(partition, calls);

      const accountSession: ElectronSessionLike = {
        clearStorageData: async () => {
          calls.push('clearStorageData');
        },
        clearCache: async () => {
          calls.push('clearCache');
        },
        cookies: {
          get: async () => [],
          set: async () => {
            calls.push('cookies.set');
          },
        },
        setProxy: async () => {
          calls.push('setProxy');
        },
        closeAllConnections: async () => {
          calls.push('closeAllConnections');
        },
      };
      return accountSession;
    },
  };

  return { sessionModule, partitions, callsByPartition };
}

describe('SessionPartitionManager', () => {
  it('maps an account id to a fixed persistent partition', () => {
    const { sessionModule } = createRecordingSessionModule();
    const manager = new SessionPartitionManager(sessionModule);

    expect(manager.getPartition('11111111-1111-4111-8111-111111111111')).toBe(
      'persist:apinest-account-11111111-1111-4111-8111-111111111111',
    );
  });

  it('returns distinct partitions for two accounts sharing a url', () => {
    const { sessionModule } = createRecordingSessionModule();
    const manager = new SessionPartitionManager(sessionModule);

    const first = manager.getPartition('11111111-1111-4111-8111-111111111111');
    const second = manager.getPartition('22222222-2222-4222-8222-222222222222');

    expect(first).not.toBe(second);
  });

  it('clears storage and cache for the target account partition only', async () => {
    const { sessionModule, partitions, callsByPartition } = createRecordingSessionModule();
    const manager = new SessionPartitionManager(sessionModule);

    await manager.clearAccountSession('11111111-1111-4111-8111-111111111111');

    const targetPartition = 'persist:apinest-account-11111111-1111-4111-8111-111111111111';
    expect(partitions).toContain(targetPartition);
    expect(callsByPartition.get(targetPartition)).toEqual(['clearStorageData', 'clearCache']);
    expect(callsByPartition.has('persist:apinest-account-22222222-2222-4222-8222-222222222222')).toBe(false);
  });

  it('maps auth ids to auth partitions distinct from account partitions', () => {
    const { sessionModule, partitions } = createRecordingSessionModule();
    const manager = new SessionPartitionManager(sessionModule);
    const authId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

    const authSession = manager.getAuthSession(authId);
    expect(authSession.cookies).toBeDefined();
    expect(partitions).toContain(`persist:apinest-auth-${authId}`);
    expect(manager.getPartition(authId)).toBe(`persist:apinest-account-${authId}`);
  });
});
