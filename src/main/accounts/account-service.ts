import { randomUUID } from 'node:crypto';
import { AppError } from '../../shared/ipc/errors';
import type { AccountRecord } from '../../shared/ipc/bridge';
import type { CreateAccountInput, UpdateAccountInput } from '../../shared/ipc/schemas';
import { normalizeBaseUrl } from '../../shared/domain/url-normalization';
import type { AccountSessionCleaner } from '../auth/session-service';
import type { AccountAuthStateRepository } from '../storage/repositories/account-auth-state-repository';
import type { AccountEntity, AccountRepository } from '../storage/repositories/account-repository';
import type { AuthIdentityRepository } from '../storage/repositories/auth-identity-repository';

export type AccountRepositoryPort = Pick<
  AccountRepository,
  'create' | 'list' | 'listBySite' | 'get' | 'update' | 'delete'
>;
type AuthStateRepositoryPort = Pick<AccountAuthStateRepository, 'getMany' | 'clearSiteIdentity'>;
type AuthIdentityRepositoryPort = Pick<AuthIdentityRepository, 'get'>;

export interface AccountServiceDependencies {
  sessionCleaner?: AccountSessionCleaner;
  authStateRepository?: AuthStateRepositoryPort;
  authIdentityRepository?: AuthIdentityRepositoryPort;
}

export function toAccountRecord(
  entity: AccountEntity,
  authState: AccountRecord['authState'] = 'unknown',
): AccountRecord {
  return {
    id: entity.id,
    siteId: entity.siteId,
    siteName: entity.siteName,
    platform: entity.platform as AccountRecord['platform'],
    baseUrl: entity.baseUrl,
    displayName: entity.displayName,
    note: entity.note,
    linuxDoClientId: entity.linuxDoClientId,
    routeProfile: entity.routeProfile,
    authState,
    authRefId: entity.authRefId ?? null,
  };
}

function assertAccountExists(entity: AccountEntity | null): asserts entity is AccountEntity {
  if (!entity) {
    throw new AppError('ACCOUNT_NOT_FOUND', 'Account was not found.');
  }
}

function assertAccountSite(entity: AccountEntity): asserts entity is AccountEntity & { siteId: string; siteName: string } {
  if (!entity.siteId || !entity.siteName) {
    throw new AppError('INTERNAL_ERROR', 'Account has no site association.');
  }
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

export interface LegacyAccountCreateInput {
  platform: AccountRecord['platform'];
  baseUrl: string;
  displayName: string;
  note?: string;
  linuxDoClientId?: string;
}

export type AccountCreateInput = CreateAccountInput | LegacyAccountCreateInput;

export class AccountService {
  private readonly sessionCleaner?: AccountSessionCleaner;
  private readonly authStateRepository?: AuthStateRepositoryPort;
  private readonly authIdentityRepository?: AuthIdentityRepositoryPort;

  constructor(
    private readonly accountRepository: AccountRepositoryPort,
    dependencies: AccountServiceDependencies = {},
  ) {
    this.sessionCleaner = dependencies.sessionCleaner;
    this.authStateRepository = dependencies.authStateRepository;
    this.authIdentityRepository = dependencies.authIdentityRepository;
  }

  list(): AccountRecord[] {
    return this.withAuthStates(this.accountRepository.list());
  }

  listBySite(siteId: string): AccountRecord[] {
    return this.withAuthStates(this.accountRepository.listBySite(siteId));
  }

  create(input: AccountCreateInput): AccountRecord {
    const now = new Date().toISOString();
    const id = randomUUID();
    if (!('siteId' in input)) {
      const baseUrl = normalizeBaseUrl(input.baseUrl);
      this.accountRepository.create({
        id,
        platform: input.platform,
        baseUrl,
        displayName: input.displayName,
        note: normalizeOptionalText(input.note),
        linuxDoClientId: normalizeOptionalText(input.linuxDoClientId),
        recordVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      this.assertAuthExists(input.authId);
      this.accountRepository.create({
        id,
        siteId: input.siteId,
        displayName: input.displayName,
        note: normalizeOptionalText(input.note),
        authRefId: input.authId ?? null,
        recordVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
    }
    const entity = this.accountRepository.get(id);
    assertAccountExists(entity);
    return toAccountRecord(entity);
  }

  update(id: string, input: UpdateAccountInput): AccountRecord {
    const current = this.accountRepository.get(id);
    assertAccountExists(current);

    const updated: AccountEntity = {
      ...current,
      displayName: input.displayName ?? current.displayName,
      note: input.note !== undefined ? normalizeOptionalText(input.note) : current.note,
      recordVersion: current.recordVersion + 1,
      updatedAt: new Date().toISOString(),
    };

    this.accountRepository.update(updated);
    return toAccountRecord(updated);
  }

  copy(id: string): AccountRecord {
    const current = this.accountRepository.get(id);
    assertAccountExists(current);
    assertAccountSite(current);

    const now = new Date().toISOString();
    const copiedId = randomUUID();
    this.accountRepository.create({
      id: copiedId,
      siteId: current.siteId,
      displayName: `${current.displayName} Copy`,
      note: current.note,
      authRefId: null,
      recordVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    const copied = this.accountRepository.get(copiedId);
    assertAccountExists(copied);
    return toAccountRecord(copied);
  }

  async remove(id: string): Promise<void> {
    const current = this.accountRepository.get(id);
    assertAccountExists(current);

    await this.sessionCleaner?.clearAccountSession(id);
    this.accountRepository.delete(id);
  }

  async clearSession(id: string): Promise<void> {
    const current = this.accountRepository.get(id);
    assertAccountExists(current);
    await this.sessionCleaner?.clearAccountSession(id);
    // 会话已清（Cookie/localStorage 失效），站内用户 ID 不再代表当前会话，一并清除。
    this.authStateRepository?.clearSiteIdentity(id);
  }

  linkAuth(id: string, authId: string | null): AccountRecord {
    const current = this.accountRepository.get(id);
    assertAccountExists(current);
    this.assertAuthExists(authId);

    const updated: AccountEntity = {
      ...current,
      authRefId: authId,
      recordVersion: current.recordVersion + 1,
      updatedAt: new Date().toISOString(),
    };

    this.accountRepository.update(updated);
    return toAccountRecord(updated);
  }

  private withAuthStates(entities: AccountEntity[]): AccountRecord[] {
    if (!this.authStateRepository) {
      return entities.map(entity => toAccountRecord(entity));
    }
    const states = this.authStateRepository.getMany(entities.map(entity => entity.id));
    return entities.map(entity => toAccountRecord(entity, states.get(entity.id)?.state ?? 'unknown'));
  }

  private assertAuthExists(authId: string | null | undefined): void {
    if (authId && this.authIdentityRepository && !this.authIdentityRepository.get(authId)) {
      throw new AppError('NOT_FOUND', 'Auth identity was not found.');
    }
  }
}
