import type { SiteRecord, SiteSummary } from '../../../../shared/ipc/bridge';

/** 站点广场筛选条件。onlyEnabled 默认 true（仅展示启用站点）。 */
export interface SiteFilter {
  /** 关键词：对 name / baseUrl 不区分大小写模糊匹配。 */
  keyword: string;
  /** 仅展示启用站点（默认视图）。 */
  onlyEnabled: boolean;
  /** 仅展示今日未签满的站点（checkedInToday < accountCount）。 */
  notCheckedInToday: boolean;
  /** 命中任一所选标签才保留；空数组表示不按标签过滤。 */
  tags: string[];
}

/** 默认筛选：仅启用、不限签到、不限标签、无关键词。 */
export const DEFAULT_SITE_FILTER: SiteFilter = {
  keyword: '',
  onlyEnabled: true,
  notCheckedInToday: false,
  tags: [],
};

/** 聚合所有站点的标签集合（去重、保序），用于筛选栏的标签多选来源。 */
export function collectSiteTags(sites: SiteRecord[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const site of sites) {
    for (const tag of site.tags) {
      if (!seen.has(tag)) {
        seen.add(tag);
        result.push(tag);
      }
    }
  }
  return result;
}

/**
 * 按筛选条件过滤站点。纯函数，便于单测。
 * - keyword：name / baseUrl 不区分大小写包含匹配（去空白后为空则跳过）。
 * - onlyEnabled：为 true 时剔除 enabled === false 的站点。
 * - notCheckedInToday：为 true 时仅保留今日未签满的站点（分子来自 summary，分母 accountCount）。
 * - tags：非空时，站点 tags 需命中任一所选标签。
 */
export function filterSites(
  sites: SiteRecord[],
  summaries: Map<string, SiteSummary>,
  filter: SiteFilter,
): SiteRecord[] {
  const keyword = filter.keyword.trim().toLowerCase();
  return sites.filter(site => {
    if (filter.onlyEnabled && site.enabled === false) return false;

    if (keyword.length > 0) {
      const haystack = `${site.name} ${site.baseUrl}`.toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }

    if (filter.notCheckedInToday) {
      const checkedInToday = summaries.get(site.id)?.checkedInToday ?? 0;
      if (site.accountCount === 0 || checkedInToday >= site.accountCount) return false;
    }

    if (filter.tags.length > 0) {
      if (!site.tags.some(tag => filter.tags.includes(tag))) return false;
    }

    return true;
  });
}
