import { describe, expect, it } from 'vitest';
import type { AccountRecord, SiteRecord } from '../../../../shared/ipc/bridge';
import { buildSiteCardView, routeProfileLabel } from './site-card-view';
import {
  EMPTY_SITE_FORM,
  describeDetectionResult,
  toCreateSiteInput,
  validateSiteForm,
} from './site-form';

const siteA: SiteRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  name: '主站',
  platform: 'newapi',
  baseUrl: 'https://example.com/',
  routeProfile: 'modern',
  accountCount: 2,
  useProxy: false,
  enabled: true,
  tags: [],
};

const siteB: SiteRecord = {
  id: '22222222-2222-4222-8222-222222222222',
  name: '备站',
  platform: 'newapi',
  baseUrl: 'https://other.example.com/',
  routeProfile: 'classic',
  accountCount: 1,
  useProxy: false,
  enabled: true,
  tags: [],
};

const accounts: AccountRecord[] = [
  {
    id: 'a1',
    siteId: siteA.id,
    siteName: siteA.name,
    platform: 'newapi',
    baseUrl: siteA.baseUrl,
    routeProfile: 'modern',
    displayName: '账号 A1',
    authState: 'active',
  },
  {
    id: 'a2',
    siteId: siteA.id,
    siteName: siteA.name,
    platform: 'newapi',
    baseUrl: siteA.baseUrl,
    routeProfile: 'modern',
    displayName: '账号 A2',
    authState: 'expired',
  },
  {
    id: 'b1',
    siteId: siteB.id,
    siteName: siteB.name,
    platform: 'newapi',
    baseUrl: siteB.baseUrl,
    routeProfile: 'classic',
    displayName: '账号 B1',
    authState: 'error',
  },
];

function buildCardActionState(site: SiteRecord, allAccounts: AccountRecord[], isBusy: boolean) {
  const view = buildSiteCardView(site, allAccounts);
  return {
    view,
    openDisabled: false,
    syncDisabled: isBusy || view.accountCount === 0,
    checkInDisabled: isBusy || view.accountCount === 0,
    editDisabled: isBusy,
  };
}

function listAccountsForSite(siteId: string, allAccounts: AccountRecord[]): AccountRecord[] {
  return allAccounts.filter(account => account.siteId === siteId);
}

function createSiteSummaryMessage(total: number, successCount: number): string {
  return `同步完成：共 ${total} 个账号，${successCount} 个已处理。`;
}

function createCheckInSummaryMessage(total: number, successCount: number): string {
  return `签到完成：成功/已签到 ${successCount}，共 ${total} 个。`;
}

function shouldOpenSiteFromKeyboard(key: string): boolean {
  return key === 'Enter' || key === ' ';
}

describe('站点卡片广场交互契约', () => {
  it('summarizes only the selected site and disables bulk actions without accounts', () => {
    const emptySite: SiteRecord = { ...siteA, id: '33333333-3333-4333-8333-333333333333', accountCount: 0 };
    const emptyState = buildCardActionState(emptySite, accounts, false);
    const busyState = buildCardActionState(siteA, accounts, true);

    expect(emptyState.view).toEqual({ accountCount: 0, active: 0, expired: 0, error: 0, unknown: 0, balanceTotal: null, checkedInToday: 0, overallStatus: 'unknown' });
    expect(emptyState.syncDisabled).toBe(true);
    expect(emptyState.checkInDisabled).toBe(true);
    expect(emptyState.editDisabled).toBe(false);

    expect(busyState.view.accountCount).toBe(2);
    expect(busyState.syncDisabled).toBe(true);
    expect(busyState.checkInDisabled).toBe(true);
    expect(busyState.editDisabled).toBe(true);
  });

  it('keeps detail account lists isolated by siteId', () => {
    expect(listAccountsForSite(siteA.id, accounts).map(account => account.id)).toEqual(['a1', 'a2']);
    expect(listAccountsForSite(siteB.id, accounts).map(account => account.id)).toEqual(['b1']);
    expect(routeProfileLabel(siteA)).toBe('新版 UI');
    expect(routeProfileLabel(siteB)).toBe('兼容旧版 UI');
  });

  it('maps create form values with optional auth and defaults to modern routes', () => {
    expect(validateSiteForm({ ...EMPTY_SITE_FORM, name: '主站', baseUrl: 'https://example.com' }, true))
      .toBe('请填写首个账号的显示名。');
    expect(toCreateSiteInput({
      ...EMPTY_SITE_FORM,
      name: '主站',
      baseUrl: 'https://example.com',
      firstAccountName: '账号 A',
      firstAuthId: 'auth-id',
    })).toMatchObject({
      name: '主站',
      routeProfile: 'modern',
      firstAccount: { displayName: '账号 A', authId: 'auth-id' },
    });
  });

  it('describes platform detection without inventing credentials and supports keyboard open keys', () => {
    expect(describeDetectionResult({ platform: 'newapi', confidence: 'high', reason: 'matched' }))
      .toContain('很可能是 NewAPI');
    expect(describeDetectionResult({ platform: 'newapi', confidence: 'unknown', reason: 'none' }))
      .toContain('手动选择');
    expect(shouldOpenSiteFromKeyboard('Enter')).toBe(true);
    expect(shouldOpenSiteFromKeyboard(' ')).toBe(true);
    expect(shouldOpenSiteFromKeyboard('Escape')).toBe(false);
  });

  it('summarizes site-level sync and check-in results without sensitive fields', () => {
    expect(createSiteSummaryMessage(2, 2)).toBe('同步完成：共 2 个账号，2 个已处理。');
    expect(createCheckInSummaryMessage(2, 1)).toBe('签到完成：成功/已签到 1，共 2 个。');
  });
});
