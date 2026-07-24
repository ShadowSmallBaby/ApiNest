import type {
  AuthIdentity,
  PlatformDetectionResult,
  PlatformType,
  SiteRecord,
  SiteRouteProfile,
} from '../../../../shared/ipc/bridge';
import type { CreateSiteInput, UpdateSiteInput } from '../../../../shared/ipc/schemas';
import { authIdentityLabel } from '../accounts/account-form';

export interface SiteFormValues {
  name: string;
  platform: PlatformType;
  baseUrl: string;
  note: string;
  linuxDoClientId: string;
  routeProfile: SiteRouteProfile;
  /** 该站点账户联网是否走全局 Proxy 模板；默认 false（直连）。 */
  useProxy: boolean;
  /** 站点启用开关；默认 true（启用）。 */
  enabled: boolean;
  /** 站点标签（纯管理性元数据，用于展示与筛选）。 */
  tags: string[];
  firstAccountName: string;
  firstAccountNote: string;
  firstAuthId: string;
}

export const PLATFORM_OPTIONS: ReadonlyArray<{ value: PlatformType; label: string }> = [
  { value: 'newapi', label: 'NewAPI' },
  { value: 'sub2api', label: 'Sub2API' },
  { value: 'cliproxyapi', label: 'CLIProxyAPI' },
];

export const EMPTY_SITE_FORM: SiteFormValues = {
  name: '',
  platform: 'newapi',
  baseUrl: '',
  note: '',
  linuxDoClientId: '',
  routeProfile: 'modern',
  useProxy: false,
  enabled: true,
  tags: [],
  firstAccountName: '',
  firstAccountNote: '',
  firstAuthId: '',
};

export function siteToFormValues(site: SiteRecord): SiteFormValues {
  return {
    name: site.name,
    platform: site.platform,
    baseUrl: site.baseUrl,
    note: site.note ?? '',
    linuxDoClientId: site.linuxDoClientId ?? '',
    routeProfile: site.routeProfile,
    useProxy: site.useProxy,
    enabled: site.enabled,
    tags: [...site.tags],
    firstAccountName: '',
    firstAccountNote: '',
    firstAuthId: '',
  };
}

export function validateSiteForm(values: SiteFormValues, includeFirstAccount: boolean): string | null {
  if (!values.name.trim()) return '请填写站名。';
  if (!/^https?:\/\//i.test(values.baseUrl.trim())) return '站点 URL 必须以 http:// 或 https:// 开头。';
  if (includeFirstAccount && !values.firstAccountName.trim()) return '请填写首个账号的显示名。';
  if (values.name.trim().length > 120 || values.firstAccountName.trim().length > 120) return '名称不能超过 120 个字符。';
  if (values.note.trim().length > 1000 || values.firstAccountNote.trim().length > 1000) return '备注不能超过 1000 个字符。';
  if (values.linuxDoClientId.trim().length > 256) return 'LinuxDo Client ID 不能超过 256 个字符。';
  return null;
}

/** 清洗表单标签：逐个去空白、剔除空串、去重（保序），至多 12 个（与后端 schema 一致）。 */
export function normalizeFormTags(tags: string[]): string[] {
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

export function toCreateSiteInput(values: SiteFormValues): CreateSiteInput {
  return {
    name: values.name.trim(),
    platform: values.platform,
    baseUrl: values.baseUrl.trim(),
    note: values.note.trim() || undefined,
    linuxDoClientId: values.linuxDoClientId.trim() || undefined,
    routeProfile: values.platform === 'newapi' ? values.routeProfile : 'modern',
    useProxy: values.useProxy,
    enabled: values.enabled,
    tags: normalizeFormTags(values.tags),
    firstAccount: {
      displayName: values.firstAccountName.trim(),
      note: values.firstAccountNote.trim() || undefined,
      authId: values.firstAuthId || null,
    },
  };
}

export function toUpdateSiteInput(values: SiteFormValues): UpdateSiteInput {
  return {
    name: values.name.trim(),
    platform: values.platform,
    baseUrl: values.baseUrl.trim(),
    note: values.note.trim() || undefined,
    linuxDoClientId: values.linuxDoClientId.trim() || undefined,
    routeProfile: values.platform === 'newapi' ? values.routeProfile : 'modern',
    useProxy: values.useProxy,
    enabled: values.enabled,
    tags: normalizeFormTags(values.tags),
  };
}

export function describeDetectionResult(result: PlatformDetectionResult): string {
  if (result.confidence === 'high') return '检测到该站点很可能是 NewAPI，请确认后继续。';
  if (result.confidence === 'low') return '仅匹配到通用特征，请手动确认站点类型。';
  return '未能确认站点类型，请使用下拉框手动选择。';
}

export function authOptions(identities: AuthIdentity[]): Array<{ value: string; label: string }> {
  return identities.map(identity => ({ value: identity.id, label: authIdentityLabel(identity) }));
}
