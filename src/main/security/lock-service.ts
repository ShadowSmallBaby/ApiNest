import { AppError } from '../../shared/ipc/errors';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import type { VaultService } from '../security/vault-service';

export class LockService {
  constructor(private readonly vaultService: VaultService) {}

  isInitialized(): boolean {
    return this.vaultService.isInitialized();
  }

  isUnlocked(): boolean {
    return this.vaultService.isUnlocked();
  }

  async initialize(masterPassword: string): Promise<void> {
    if (this.isInitialized()) {
      throw new AppError('INVALID_ARGUMENT', 'Master password has already been configured.');
    }

    await this.vaultService.initialize(masterPassword);
  }

  async unlock(masterPassword: string): Promise<void> {
    await this.vaultService.unlock(masterPassword);
  }

  lock(): void {
    this.vaultService.lock();
  }

  assertUnlocked(): void {
    if (!this.isUnlocked()) {
      throw new AppError('LOCKED', 'Application is locked. Unlock it before using sensitive capabilities.');
    }
  }
}

export function createAuthHandler(lockService: LockService) {
  return {
    [IPC_CHANNELS.auth.unlock]: async (payload: { masterPassword: string }) => {
      if (!lockService.isInitialized()) {
        await lockService.initialize(payload.masterPassword);
        return;
      }

      await lockService.unlock(payload.masterPassword);
    },
    [IPC_CHANNELS.auth.lock]: async () => {
      lockService.lock();
    },
  };
}
