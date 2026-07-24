import type {
  AuthIdentity,
  OAuthProvider,
  PlatformDetectionResult,
  PlatformType,
  SiteRecord,
  SiteRouteProfile,
} from '../../../../shared/ipc/bridge';
import type { CreateSiteInput, UpdateSiteInput } from '../../../../shared/ipc/schemas';
import { authIdentityLabel } from '../accounts/account-form';

/** 表单内草稿态的站点 OAuth 配置（创建时尚未有 siteId）。 */
export interface SiteFormOAuthConfig {
  provider: OAuthProvider;
  clientId: string;
  note?: string;
}

export interface SiteFormValues {
  name: string;
  platform: PlatformType;
  baseUrl: string;
  note: string;
  routeProfile: SiteRouteProfile;
  /** 该站点账户联网是否走全局 Proxy 模板；默认 false（直连）。 */
  useProxy: boolean;
  /** 站点启用开关；默认 true（启用）。 */
  enabled: boolean;
  /** 站点标签（纯管理性元数据，用于展示与筛选）。 */
  tags: string[];
  /** 参与广场一键登录；开启后账户须绑定本站 OAuth 身份。 */
  autoLogin: boolean;
  /** 参与广场一键 API 签到；与 checkInSiteUrl 互斥。 */
  autoCheckIn: boolean;
  /** 额外签到站 URL；有值时禁用 autoCheckIn。 */
  checkInSiteUrl: string;
  /** 站点级多 OAuth 配置草稿（提交后由页面同步到 site_oauth_configs）。 */
  oauthConfigs: SiteFormOAuthConfig[];
  firstAccountName: string;
  firstAccountNote: string;
  firstAuthId: string;
}

export const PLATFORM_OPTIONS: ReadonlyArray<{ value: PlatformType; label: string }> = [
  { value: 'newapi', label: 'NewAPI' },
  { value: 'sub2api', label: 'Sub2API' },
  { value: 'cliproxyapi', label: 'CLIProxyAPI' },
];

export const OAUTH_PROVIDER_OPTIONS: ReadonlyArray<{ value: OAuthProvider; label: string }> = [
  { value: 'github', label: 'GitHub OAuth' },
  { value: 'linuxdo', label: 'LinuxDo OAuth' },
];

export const EMPTY_SITE_FORM: SiteFormValues = {
  name: '',
  platform: 'newapi',
  baseUrl: '',
  note: '',
  routeProfile: 'modern',
  useProxy: false,
  enabled: true,
  tags: [],
  autoLogin: false,
  autoCheckIn: false,
  checkInSiteUrl: '',
  oauthConfigs: [],
  firstAccountName: '',
  firstAccountNote: '',
  firstAuthId: '',
};

/** 从站点记录与已加载的 OAuth 配置构造表单初值。 */
export function siteToFormValues(
  site: SiteRecord,
  oauthConfigs: SiteFormOAuthConfig[] = [],
): SiteFormValues {
  // 兼容：若新表尚无数据但站点仍有历史 linuxDoClientId，预填到草稿。
  const configs =
    oauthConfigs.length > 0
      ? oauthConfigs
      : site.linuxDoClientId
        ? [{ provider: 'linuxdo' as const, clientId: site.linuxDoClientId }]
        : [];

  return {
    name: site.name,
    platform: site.platform,
    baseUrl: site.baseUrl,
    note: site.note ?? '',
    routeProfile: site.routeProfile,
    useProxy: site.useProxy,
    enabled: site.enabled,
    tags: [...site.tags],
    autoLogin: site.autoLogin,
    autoCheckIn: site.autoCheckIn,
    checkInSiteUrl: site.checkInSiteUrl ?? '',
    oauthConfigs: configs,
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
  for (const config of values.oauthConfigs) {
    if (!config.clientId.trim()) return `${oauthProviderLabel(config.provider)} 的 Client ID 不能为空。`;
    if (config.clientId.trim().length > 200) return 'OAuth Client ID 不能超过 200 个字符。';
  }
  const providers = values.oauthConfigs.map(c => c.provider);
  if (new Set(providers).size !== providers.length) return '同一 OAuth 提供商只能配置一次。';

  const checkInUrl = values.checkInSiteUrl.trim();
  if (checkInUrl && !/^https?:\/\//i.test(checkInUrl)) {
    return '签到站地址必须以 http:// 或 https:// 开头。';
  }
  if (checkInUrl.length > 2048) return '签到站地址不能超过 2048 个字符。';
  if (values.autoCheckIn && checkInUrl) {
    return '配置了额外签到站时暂不支持自动签到。';
  }
  if (values.autoLogin && values.oauthConfigs.length === 0) {
    return '启用自动登录前请先配置至少一个 OAuth Client ID。';
  }
  if (includeFirstAccount && values.autoLogin && !values.firstAuthId) {
    return '启用自动登录时，首个账号必须绑定 OAuth 身份（不可使用 CK 认证）。';
  }
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

/** 从 OAuth 配置草稿提取 LinuxDo Client ID（向后兼容 sites.linuxdo_client_id）。 */
export function extractLinuxDoClientId(configs: SiteFormOAuthConfig[]): string | undefined {
  const found = configs.find(c => c.provider === 'linuxdo');
  const id = found?.clientId.trim();
  return id && id.length > 0 ? id : undefined;
}

export function toCreateSiteInput(values: SiteFormValues): CreateSiteInput {
  const checkInSiteUrl = values.checkInSiteUrl.trim() || undefined;
  return {
    name: values.name.trim(),
    platform: values.platform,
    baseUrl: values.baseUrl.trim(),
    note: values.note.trim() || undefined,
    // 向后兼容：仍写入 sites.linuxdo_client_id，供旧登录路径回退。
    linuxDoClientId: extractLinuxDoClientId(values.oauthConfigs),
    routeProfile: values.platform === 'newapi' ? values.routeProfile : 'modern',
    useProxy: values.useProxy,
    enabled: values.enabled,
    tags: normalizeFormTags(values.tags),
    autoLogin: values.autoLogin,
    autoCheckIn: checkInSiteUrl ? false : values.autoCheckIn,
    checkInSiteUrl,
    firstAccount: {
      displayName: values.firstAccountName.trim(),
      note: values.firstAccountNote.trim() || undefined,
      authId: values.firstAuthId || null,
    },
  };
}

export function toUpdateSiteInput(values: SiteFormValues): UpdateSiteInput {
  const checkInSiteUrl = values.checkInSiteUrl.trim() || undefined;
  return {
    name: values.name.trim(),
    platform: values.platform,
    baseUrl: values.baseUrl.trim(),
    note: values.note.trim() || undefined,
    linuxDoClientId: extractLinuxDoClientId(values.oauthConfigs),
    routeProfile: values.platform === 'newapi' ? values.routeProfile : 'modern',
    useProxy: values.useProxy,
    enabled: values.enabled,
    tags: normalizeFormTags(values.tags),
    autoLogin: values.autoLogin,
    autoCheckIn: checkInSiteUrl ? false : values.autoCheckIn,
    // 空串表示清除外部签到站；service 侧会 normalize 为 undefined。
    checkInSiteUrl: checkInSiteUrl ?? '',
  };
}

export function describeDetectionResult(result: PlatformDetectionResult): string {
  if (result.confidence === 'high') return `✓ 检测到该站点类型为 ${platformLabel(result.platform)}`;
  if (result.confidence === 'low') return '仅匹配到通用特征，请手动确认站点类型';
  return '未能确认站点类型，请手动选择';
}

function platformLabel(platform: PlatformType): string {
  const option = PLATFORM_OPTIONS.find(opt => opt.value === platform);
  return option ? option.label : platform;
}

export function oauthProviderLabel(provider: OAuthProvider): string {
  return OAUTH_PROVIDER_OPTIONS.find(opt => opt.value === provider)?.label ?? provider;
}

export function authOptions(identities: AuthIdentity[]): Array<{ value: string; label: string }> {
  return identities.map(identity => ({ value: identity.id, label: authIdentityLabel(identity) }));
}

/**
 * 同步站点 OAuth 配置：以表单草稿为准，
 * - 草稿中有的：upsert
 * - 服务端有但草稿没有的：delete
 */
export async function syncSiteOAuthConfigs(
  siteId: string,
  draft: SiteFormOAuthConfig[],
  existingProviders: OAuthProvider[],
): Promise<void> {
  const draftProviders = new Set(draft.map(c => c.provider));
  for (const config of draft) {
    await window.apinest.sites.upsertOAuthConfig(
      siteId,
      config.provider,
      config.clientId.trim(),
      config.note?.trim() || undefined,
    );
  }
  for (const provider of existingProviders) {
    if (!draftProviders.has(provider)) {
      await window.apinest.sites.deleteOAuthConfig(siteId, provider);
    }
  }
}
