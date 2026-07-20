import { describe, expect, it } from 'vitest';
import type { AccountRecord, SiteRecord } from '../../../../shared/ipc/bridge';
import { buildSiteCardView, routeProfileLabel } from './site-card-view';

const site: SiteRecord = {
  id: '11111111-1111-4111-8111-111111111111', name: '主站', platform: 'newapi',
  baseUrl: 'https://example.com', routeProfile: 'classic', accountCount: 2, useProxy: false,
};

const accounts: AccountRecord[] = [
  { id: 'a', siteId: site.id, siteName: site.name, platform: 'newapi', baseUrl: site.baseUrl, routeProfile: 'classic', displayName: 'A', authState: 'active' },
  { id: 'b', siteId: site.id, siteName: site.name, platform: 'newapi', baseUrl: site.baseUrl, routeProfile: 'classic', displayName: 'B', authState: 'expired' },
  { id: 'c', siteId: 'other', siteName: '其他', platform: 'newapi', baseUrl: 'https://other.com', routeProfile: 'modern', displayName: 'C', authState: 'error' },
];

describe('site-card-view', () => {
  it('summarizes only accounts belonging to the site', () => {
    expect(buildSiteCardView(site, accounts)).toEqual({ accountCount: 2, active: 1, expired: 1, error: 0, unknown: 0 });
  });

  it('labels route profiles without inferring platform-specific URLs in UI', () => {
    expect(routeProfileLabel(site)).toBe('兼容旧版 UI');
    expect(routeProfileLabel({ ...site, routeProfile: 'modern' })).toBe('新版 UI');
    expect(routeProfileLabel({ ...site, routeProfile: 'legacy-panel' })).toBe('历史 Panel 路由');
    expect(routeProfileLabel({ ...site, platform: 'sub2api' })).toBe('平台默认路由');
  });
});
