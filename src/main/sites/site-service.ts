import { randomUUID } from 'node:crypto';
import { AppError } from '../../shared/ipc/errors';
import type { AccountRecord, PlatformDetectionResult, SiteRecord } from '../../shared/ipc/bridge';
import type {
  CreateSiteAccountInput,
  CreateSiteInput,
  UpdateSiteInput,
} from '../../shared/ipc/schemas';
import { normalizeBaseUrl } from '../../shared/domain/url-normalization';
import { toAccountRecord } from '../accounts/account-service';
import type { AccountSessionCleaner } from '../auth/session-service';
import type { AccountRepository } from '../storage/repositories/account-repository';
import type { AuthIdentityRepository } from '../storage/repositories/auth-identity-repository';
import type { SiteEntity, SiteRepository } from '../storage/repositories/site-repository';

interface PlatformDetector {
  detect(baseUrl: string, useProxy?: boolean): Promise<PlatformDetectionResult>;
}

interface SiteServiceDependencies {
  siteRepository: Pick<SiteRepository, 'create' | 'list' | 'get' | 'update' | 'delete' | 'transaction'>;
  accountRepository: Pick<AccountRepository, 'create' | 'listBySite' | 'get'>;
  authIdentityRepository: Pick<AuthIdentityRepository, 'get'>;
  platformDetector: PlatformDetector;
  sessionCleaner?: AccountSessionCleaner;
  /** 网络策略失效端口（阶段 6）：Site 切换 useProxy 后使其账户 partition 热切换。 */
  networkInvalidator?: { invalidateAccount(accountId: string): void };
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function toSiteRecord(entity: SiteEntity, accountCount: number): SiteRecord {
  return {
    id: entity.id,
    name: entity.name,
    platform: entity.platform,
    baseUrl: entity.baseUrl,
    note: entity.note,
    linuxDoClientId: entity.linuxDoClientId,
    routeProfile: entity.routeProfile,
    useProxy: entity.useProxy,
    accountCount,
  };
}

export class SiteService {
  constructor(private readonly deps: SiteServiceDependencies) {}

  list(): SiteRecord[] {
    return this.deps.siteRepository.list().map(site =>
      toSiteRecord(site, this.deps.accountRepository.listBySite(site.id).length),
    );
  }

  get(siteId: string): SiteRecord {
    const site = this.requireSite(siteId);
    return toSiteRecord(site, this.deps.accountRepository.listBySite(siteId).length);
  }

  detectPlatform(baseUrl: string, useProxy?: boolean): Promise<PlatformDetectionResult> {
    return this.deps.platformDetector.detect(normalizeBaseUrl(baseUrl), useProxy);
  }

  create(input: CreateSiteInput): { site: SiteRecord; account: AccountRecord } {
    this.assertAuthExists(input.firstAccount.authId);
    const now = new Date().toISOString();
    const site: SiteEntity = {
      id: randomUUID(),
      name: input.name,
      platform: input.platform,
      baseUrl: normalizeBaseUrl(input.baseUrl),
      note: normalizeOptionalText(input.note),
      linuxDoClientId: normalizeOptionalText(input.linuxDoClientId),
      routeProfile: input.platform === 'newapi' ? input.routeProfile : 'modern',
      useProxy: input.useProxy ?? false,
      recordVersion: 1,
      createdAt: now,
      updatedAt: now,
    };
    const accountId = randomUUID();

    this.deps.siteRepository.transaction(() => {
      this.deps.siteRepository.create(site);
      this.deps.accountRepository.create({
        id: accountId,
        siteId: site.id,
        displayName: input.firstAccount.displayName,
        note: normalizeOptionalText(input.firstAccount.note),
        authRefId: input.firstAccount.authId ?? null,
        recordVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
    });

    const account = this.deps.accountRepository.get(accountId);
    if (!account) {
      throw new AppError('INTERNAL_ERROR', 'The first site account could not be loaded.');
    }
    return { site: toSiteRecord(site, 1), account: toAccountRecord(account) };
  }

  update(siteId: string, input: UpdateSiteInput): SiteRecord {
    const current = this.requireSite(siteId);
    const platform = input.platform ?? current.platform;
    const updated: SiteEntity = {
      ...current,
      name: input.name ?? current.name,
      platform,
      baseUrl: input.baseUrl ? normalizeBaseUrl(input.baseUrl) : current.baseUrl,
      note: input.note !== undefined ? normalizeOptionalText(input.note) : current.note,
      linuxDoClientId: input.linuxDoClientId !== undefined
        ? normalizeOptionalText(input.linuxDoClientId)
        : current.linuxDoClientId,
      routeProfile: platform === 'newapi'
        ? (input.routeProfile ?? current.routeProfile)
        : 'modern',
      useProxy: input.useProxy ?? current.useProxy,
      recordVersion: current.recordVersion + 1,
      updatedAt: new Date().toISOString(),
    };
    this.deps.siteRepository.update(updated);
    // useProxy 变化：使该 Site 全部账户 partition 的代理策略失效，下次请求前热切换。
    if (updated.useProxy !== current.useProxy) {
      for (const account of this.deps.accountRepository.listBySite(siteId)) {
        this.deps.networkInvalidator?.invalidateAccount(account.id);
      }
    }
    return toSiteRecord(updated, this.deps.accountRepository.listBySite(siteId).length);
  }

  addAccount(siteId: string, input: CreateSiteAccountInput): AccountRecord {
    this.requireSite(siteId);
    this.assertAuthExists(input.authId);
    const now = new Date().toISOString();
    const accountId = randomUUID();
    this.deps.accountRepository.create({
      id: accountId,
      siteId,
      displayName: input.displayName,
      note: normalizeOptionalText(input.note),
      authRefId: input.authId ?? null,
      recordVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    const account = this.deps.accountRepository.get(accountId);
    if (!account) {
      throw new AppError('INTERNAL_ERROR', 'The site account could not be loaded.');
    }
    return toAccountRecord(account);
  }

  async remove(siteId: string): Promise<void> {
    this.requireSite(siteId);
    const accounts = this.deps.accountRepository.listBySite(siteId);
    for (const account of accounts) {
      await this.deps.sessionCleaner?.clearAccountSession(account.id);
    }
    this.deps.siteRepository.delete(siteId);
  }

  private requireSite(siteId: string): SiteEntity {
    const site = this.deps.siteRepository.get(siteId);
    if (!site) {
      throw new AppError('NOT_FOUND', 'Site was not found.');
    }
    return site;
  }

  private assertAuthExists(authId: string | null | undefined): void {
    if (authId && !this.deps.authIdentityRepository.get(authId)) {
      throw new AppError('NOT_FOUND', 'Auth identity was not found.');
    }
  }
}
