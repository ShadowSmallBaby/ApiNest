import { randomUUID } from 'node:crypto';
import { AppError } from '../../shared/ipc/errors';
import type { AccountRecord, PlatformDetectionResult, SiteRecord, SiteSummary } from '../../shared/ipc/bridge';
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
import type { CheckInResultRepository } from '../storage/repositories/checkin-result-repository';
import type { SiteEntity, SiteRepository } from '../storage/repositories/site-repository';
import type { SnapshotRepository } from '../storage/repositories/snapshot-repository';

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
  /** 站点广场聚合所需：余额快照求和与今日签到计数（可选，未注入则 getSummaries 返回空聚合）。 */
  snapshotRepository?: Pick<SnapshotRepository, 'sumBalanceBySite'>;
  checkInResultRepository?: Pick<CheckInResultRepository, 'countCheckedInTodayBySite'>;
}

/** 计算「今日 0 点」的本地时间对应 ISO 字符串，用于今日签到聚合的下界。 */
function startOfTodayIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * 规范化站点标签：逐个去空白、剔除空串、去重（保序），至多保留 12 个。
 * schemas 已在 IPC 边界校验单标签长度与数量上限，这里做最终落库前的清洗兜底。
 */
function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags || tags.length === 0) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    if (tag.length === 0 || seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
    if (result.length >= 12) break;
  }
  return result;
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
    enabled: entity.enabled,
    tags: entity.tags,
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

  /**
   * 站点广场聚合：为每个站点计算余额合计与今日已签到去重账号数。
   * balanceTotal：该站点账户最新 balance 快照换算后的 USD 合计；全无有效快照时为 null
   * （红线：无快照不伪造 0，UI 显示「暂无余额」）。
   * checkedInToday：今日 result ∈ {success, already_checked_in} 的去重账号数（分子）。
   * 未注入聚合 repository 时（如内存模式）返回全 null/0，不抛错。
   */
  getSummaries(): SiteSummary[] {
    const balanceBySite = this.deps.snapshotRepository?.sumBalanceBySite() ?? new Map();
    const checkedInBySite =
      this.deps.checkInResultRepository?.countCheckedInTodayBySite(startOfTodayIso()) ?? new Map();
    return this.deps.siteRepository.list().map(site => {
      const balance = balanceBySite.get(site.id);
      return {
        siteId: site.id,
        balanceTotal: balance && balance.count > 0 ? balance.total : null,
        checkedInToday: checkedInBySite.get(site.id) ?? 0,
      };
    });
  }

  openWebsiteUrl(siteId: string): string {
    return this.requireSite(siteId).baseUrl;
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
      enabled: input.enabled ?? true,
      tags: normalizeTags(input.tags),
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
      enabled: input.enabled ?? current.enabled,
      tags: input.tags !== undefined ? normalizeTags(input.tags) : current.tags,
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
