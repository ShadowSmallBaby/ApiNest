import type { AdapterAccount } from '../../../shared/domain/platform-adapter';
import { DEFAULT_MANUAL_OAUTH_DOMAINS } from '../../auth/idp-hosts';
import { resolveNewApiPageUrl } from './newapi-routes';

/** LinuxDo OAuth 授权 host；与 idp-hosts 默认 manual 白名单保持一致。 */
const LINUXDO_OAUTH_HOST = DEFAULT_MANUAL_OAUTH_DOMAINS[1];

export interface LinuxDoOAuthPlan {
  startUrl: URL;
  oauthDomains: string[];
  redirectDomains: string[];
}

/**
 * 仅从目标 NewAPI 的官方登录页启动专用流程，由站点页面自行发起 LinuxDo OAuth。
 * Client ID 只用作用户已配置专用流程的前置条件；应用不猜测或交换 OAuth code，
 * 不拼接 LinuxDo 授权 URL、Client ID 或任意回跳地址。
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

    return {
      startUrl,
      oauthDomains: [LINUXDO_OAUTH_HOST],
      redirectDomains: [baseUrl.hostname],
    };
  } catch {
    return null;
  }
}
