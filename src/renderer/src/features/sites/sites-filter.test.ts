import { describe, expect, it } from 'vitest';
import type { SiteRecord, SiteSummary } from '../../../../shared/ipc/bridge';
import { DEFAULT_SITE_FILTER, collectSiteTags, filterSites } from './sites-filter';

function site(overrides: Partial<SiteRecord> & Pick<SiteRecord, 'id' | 'name'>): SiteRecord {
  return {
    platform: 'newapi',
    baseUrl: 'https://example.com',
    routeProfile: 'modern',
    useProxy: false,
    enabled: true,
    tags: [],
    autoLogin: false,
    autoCheckIn: false,
    accountCount: 1,
    ...overrides,
  };
}

const alpha = site({ id: 's1', name: 'Alpha', baseUrl: 'https://alpha.example.com', tags: ['主力', '备用'], accountCount: 2 });
const beta = site({ id: 's2', name: 'Beta', baseUrl: 'https://beta.test.com', tags: ['备用'], accountCount: 1 });
const disabledSite = site({ id: 's3', name: 'Gamma', enabled: false, tags: ['归档'] });
const allSites = [alpha, beta, disabledSite];

const summaries = new Map<string, SiteSummary>([
  ['s1', { siteId: 's1', balanceTotal: 100, checkedInToday: 1 }], // 2 账号签到 1 → 未签满
  ['s2', { siteId: 's2', balanceTotal: null, checkedInToday: 1 }], // 1 账号签到 1 → 已签满
]);

describe('collectSiteTags', () => {
  it('collects unique tags in order across all sites', () => {
    expect(collectSiteTags(allSites)).toEqual(['主力', '备用', '归档']);
  });

  it('returns an empty array when no site has tags', () => {
    expect(collectSiteTags([site({ id: 'x', name: 'X' })])).toEqual([]);
  });
});

describe('filterSites', () => {
  it('hides disabled sites by default (onlyEnabled)', () => {
    expect(filterSites(allSites, summaries, DEFAULT_SITE_FILTER).map(s => s.id)).toEqual(['s1', 's2']);
  });

  it('includes disabled sites when onlyEnabled is off', () => {
    expect(filterSites(allSites, summaries, { ...DEFAULT_SITE_FILTER, onlyEnabled: false }).map(s => s.id))
      .toEqual(['s1', 's2', 's3']);
  });

  it('matches keyword against name and baseUrl case-insensitively', () => {
    expect(filterSites(allSites, summaries, { ...DEFAULT_SITE_FILTER, keyword: 'ALPHA' }).map(s => s.id)).toEqual(['s1']);
    expect(filterSites(allSites, summaries, { ...DEFAULT_SITE_FILTER, keyword: 'test.com' }).map(s => s.id)).toEqual(['s2']);
    expect(filterSites(allSites, summaries, { ...DEFAULT_SITE_FILTER, keyword: '缺失' })).toEqual([]);
  });

  it('keeps only sites not fully checked in today when requested', () => {
    // s1 未签满保留；s2 已签满剔除；禁用的 s3 因 onlyEnabled 已被剔除
    expect(filterSites(allSites, summaries, { ...DEFAULT_SITE_FILTER, notCheckedInToday: true }).map(s => s.id))
      .toEqual(['s1']);
  });

  it('treats sites without accounts as fully checked in (excluded)', () => {
    const noAccount = site({ id: 's4', name: 'Delta', accountCount: 0 });
    expect(filterSites([noAccount], new Map(), { ...DEFAULT_SITE_FILTER, notCheckedInToday: true })).toEqual([]);
  });

  it('keeps sites matching any selected tag', () => {
    expect(filterSites(allSites, summaries, { ...DEFAULT_SITE_FILTER, tags: ['主力'] }).map(s => s.id)).toEqual(['s1']);
    expect(filterSites(allSites, summaries, { ...DEFAULT_SITE_FILTER, tags: ['备用'] }).map(s => s.id)).toEqual(['s1', 's2']);
  });

  it('combines keyword, tag and enabled filters', () => {
    expect(
      filterSites(allSites, summaries, { keyword: 'example', onlyEnabled: true, notCheckedInToday: false, tags: ['备用'] })
        .map(s => s.id),
    ).toEqual(['s1']);
  });
});
