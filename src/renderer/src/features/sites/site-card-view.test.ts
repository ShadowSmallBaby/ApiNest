import { describe, expect, it } from 'vitest';
import type { AccountRecord, SiteRecord, SiteSummary } from '../../../../shared/ipc/bridge';
import {
  balanceTotalLabel,
  buildSiteCardView,
  overallStatusLabel,
  platformLabel,
  routeProfileLabel,
} from './site-card-view';

const site: SiteRecord = {
  id: '11111111-1111-4111-8111-111111111111', name: '主站', platform: 'newapi',
  baseUrl: 'https://example.com', routeProfile: 'classic', accountCount: 2, useProxy: false,
  enabled: true, tags: [], autoLogin: false, autoCheckIn: false,
};

const accounts: AccountRecord[] = [
  { id: 'a', siteId: site.id, siteName: site.name, platform: 'newapi', baseUrl: site.baseUrl, routeProfile: 'classic', displayName: 'A', authState: 'active' },
  { id: 'b', siteId: site.id, siteName: site.name, platform: 'newapi', baseUrl: site.baseUrl, routeProfile: 'classic', displayName: 'B', authState: 'expired' },
  { id: 'c', siteId: 'other', siteName: '其他', platform: 'newapi', baseUrl: 'https://other.com', routeProfile: 'modern', displayName: 'C', authState: 'error' },
];

describe('site-card-view', () => {
  it('summarizes only accounts belonging to the site', () => {
    expect(buildSiteCardView(site, accounts)).toEqual({
      accountCount: 2, active: 1, expired: 1, error: 0, unknown: 0,
      balanceTotal: null, checkedInToday: 0, overallStatus: 'expired',
    });
  });

  it('labels route profiles without inferring platform-specific URLs in UI', () => {
    expect(routeProfileLabel(site)).toBe('兼容旧版 UI');
    expect(routeProfileLabel({ ...site, routeProfile: 'modern' })).toBe('新版 UI');
    expect(routeProfileLabel({ ...site, routeProfile: 'legacy-panel' })).toBe('历史 Panel 路由');
    expect(routeProfileLabel({ ...site, platform: 'sub2api' })).toBe('平台默认路由');
  });

  it('folds summary balance and check-in counts into the card view', () => {
    const summary: SiteSummary = { siteId: site.id, balanceTotal: 12345, checkedInToday: 1 };
    const view = buildSiteCardView(site, accounts, summary);
    expect(view.balanceTotal).toBe(12345);
    expect(view.checkedInToday).toBe(1);
  });

  it('derives overall status by priority error > expired > active > unknown', () => {
    // 当前 site 有 active + expired（无 error）→ expired
    expect(buildSiteCardView(site, accounts).overallStatus).toBe('expired');
    // 加入一个 error 账号后升级为 error
    const withError: AccountRecord[] = [
      ...accounts,
      { id: 'd', siteId: site.id, siteName: site.name, platform: 'newapi', baseUrl: site.baseUrl, routeProfile: 'classic', displayName: 'D', authState: 'error' },
    ];
    expect(buildSiteCardView(site, withError).overallStatus).toBe('error');
    // 无账号 → unknown
    expect(buildSiteCardView(site, []).overallStatus).toBe('unknown');
  });

  it('maps platform and overall status labels for display', () => {
    expect(platformLabel(site)).toBe('NewAPI');
    expect(platformLabel({ ...site, platform: 'sub2api' })).toBe('Sub2API');
    expect(platformLabel({ ...site, platform: 'cliproxyapi' })).toBe('CLIProxyAPI');
    expect(overallStatusLabel('active')).toBe('有效');
    expect(overallStatusLabel('expired')).toBe('过期');
    expect(overallStatusLabel('error')).toBe('异常');
    expect(overallStatusLabel('unknown')).toBe('未知');
  });

  it('formats USD balance totals with two decimals (red line: null not zero)', () => {
    expect(balanceTotalLabel(null)).toBe('暂无余额');
    expect(balanceTotalLabel(0)).toBe('余额合计 $0.00');
    expect(balanceTotalLabel(2)).toBe('余额合计 $2.00');
    expect(balanceTotalLabel(128.483746)).toBe('余额合计 $128.48');
  });
});
