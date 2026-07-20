import type { AccountEntity } from '../storage/repositories/account-repository';
import type { AccountAuthStateEntity } from '../storage/repositories/account-auth-state-repository';
import type { SessionValidationOutcome, SessionValidator } from './session-validator';
import { AuthSessionService } from './auth-session-service';

function createAccountEntity(id: string): AccountEntity {
  return {
    id,
    platform: 'newapi',
    baseUrl: 'https://example.com',
    displayName: 'Account',
    recordVersion: 1,
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:00.000Z',
  };
}

function createFakeAuthStateRepository() {
  const states = new Map<string, AccountAuthStateEntity>();
  return {
    states,
    get: (accountId: string) => states.get(accountId) ?? null,
    getMany: (accountIds: string[]) => {
      const result = new Map<string, AccountAuthStateEntity>();
      for (const id of accountIds) {
        const entity = states.get(id);
        if (entity) {
          result.set(id, entity);
        }
      }
      return result;
    },
    getSiteUserId: (accountId: string) => states.get(accountId)?.siteUserId ?? null,
    upsert: (entity: AccountAuthStateEntity) => {
      states.set(entity.accountId, entity);
    },
  };
}

function createValidator(outcome: SessionValidationOutcome): SessionValidator {
  return { validate: async () => outcome };
}

const idA = '11111111-1111-4111-8111-111111111111';
const idB = '22222222-2222-4222-8222-222222222222';

describe('AuthSessionService', () => {
  it('persists and returns the validated state', async () => {
    const authStateRepository = createFakeAuthStateRepository();
    const service = new AuthSessionService({
      authStateRepository,
      accountRepository: { get: () => createAccountEntity(idA) },
      sessionValidator: createValidator({ state: 'active' }),
      now: () => '2026-07-13T10:00:00.000Z',
    });

    await expect(service.refreshAuthState(idA)).resolves.toBe('active');
    const stored = authStateRepository.states.get(idA);
    expect(stored?.state).toBe('active');
    expect(stored?.lastVerifiedAt).toBe('2026-07-13T10:00:00.000Z');
  });

  it('does not fabricate success and records sanitized errors', async () => {
    const authStateRepository = createFakeAuthStateRepository();
    authStateRepository.states.set(idA, {
      accountId: idA,
      state: 'active',
      lastVerifiedAt: '2026-07-01T00:00:00.000Z',
    });

    const service = new AuthSessionService({
      authStateRepository,
      accountRepository: { get: () => createAccountEntity(idA) },
      sessionValidator: createValidator({
        state: 'error',
        errorCode: 'SESSION_CHECK_FAILED',
        errorSummary: 'validation failed',
      }),
    });

    await expect(service.refreshAuthState(idA)).resolves.toBe('error');
    const stored = authStateRepository.states.get(idA);
    expect(stored?.state).toBe('error');
    expect(stored?.lastErrorCode).toBe('SESSION_CHECK_FAILED');
    // 保留最近一次成功校验时间。
    expect(stored?.lastVerifiedAt).toBe('2026-07-01T00:00:00.000Z');
  });

  it('keeps expired/unknown from being upgraded to active', async () => {
    const authStateRepository = createFakeAuthStateRepository();
    const service = new AuthSessionService({
      authStateRepository,
      accountRepository: { get: () => createAccountEntity(idA) },
      sessionValidator: createValidator({ state: 'expired' }),
    });

    await expect(service.refreshAuthState(idA)).resolves.toBe('expired');
    expect(authStateRepository.states.get(idA)?.lastVerifiedAt).toBeUndefined();
  });

  it('throws when the account is missing', async () => {
    const authStateRepository = createFakeAuthStateRepository();
    const service = new AuthSessionService({
      authStateRepository,
      accountRepository: { get: () => null },
      sessionValidator: createValidator({ state: 'active' }),
    });

    await expect(service.refreshAuthState(idA)).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
  });

  it('isolates state between accounts', async () => {
    const authStateRepository = createFakeAuthStateRepository();
    authStateRepository.states.set(idB, {
      accountId: idB,
      state: 'active',
      lastVerifiedAt: '2026-07-10T00:00:00.000Z',
    });

    const service = new AuthSessionService({
      authStateRepository,
      accountRepository: { get: () => createAccountEntity(idA) },
      sessionValidator: createValidator({ state: 'expired' }),
    });

    await service.refreshAuthState(idA);

    expect(authStateRepository.states.get(idA)?.state).toBe('expired');
    expect(authStateRepository.states.get(idB)?.state).toBe('active');
  });
});
