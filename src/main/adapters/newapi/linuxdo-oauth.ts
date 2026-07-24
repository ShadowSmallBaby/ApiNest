import type { AdapterAccount } from '../../../shared/domain/platform-adapter';
import { DEFAULT_MANUAL_OAUTH_DOMAINS } from '../../auth/idp-hosts';
import { resolveNewApiPageUrl } from './newapi-routes';
import { buildLinuxDoOAuthUrls } from './linuxdo-oauth-protocol';

/** LinuxDo OAuth 授权 host；与 idp-hosts 默认 manual 白名单保持一致。 */
const LINUXDO_OAUTH_HOST = DEFAULT_MANUAL_OAUTH_DOMAINS[1];

export interface LinuxDoOAuthPlan {
  /** 手动降级时打开的站点登录页。 */
  startUrl: URL;
  oauthDomains: string[];
  redirectDomains: string[];
  /** 站点 OAuth state 接口（无 query 时由编排补 aff）。 */
  stateUrl: URL;
  /** 已配置的 Client ID（仅用于拼 authorize，不落日志）。 */
  clientId: string;
  siteOrigin: string;
}

/**
 * 解析 LinuxDo 专用流程前置条件与受信 host。
 *
 * 2026-07-22 主人授权：主进程可在账户 partition 内用 Client ID 拼装 authorize URL，
 * 代点同意并完成站点回调；code 仅瞬态。手动降级仍打开站点官方登录页。
 */
export function resolveLinuxDoOAuthPlan(account: AdapterAccount): LinuxDoOAuthPlan | null {
  if (account.platform !== 'newapi' || !account.linuxDoClientId?.trim()) {
    return null;
  }

  try {
    const baseUrl = new URL(account.baseUrl);
    if (baseUrl.protocol !== 'https:' && baseUrl.protocol !== 'http:') {
      return null;
    }

    const startUrl = resolveNewApiPageUrl(account.baseUrl, 'login', account.routeProfile);
    if (!startUrl) {
      return null;
    }

    // 用占位 state 校验 URL 可拼装；真实 state 在无头流程中从站点接口取得。
    const probe = buildLinuxDoOAuthUrls(account.baseUrl, account.linuxDoClientId, 'probe');
    if (!probe) {
      return null;
    }

    return {
      startUrl,
      oauthDomains: [LINUXDO_OAUTH_HOST],
      redirectDomains: [baseUrl.hostname],
      stateUrl: new URL(probe.stateUrl),
      clientId: account.linuxDoClientId.trim(),
      siteOrigin: baseUrl.origin,
    };
  } catch {
    return null;
  }
}
