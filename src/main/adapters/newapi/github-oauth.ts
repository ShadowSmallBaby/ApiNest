import type { AdapterAccount } from '../../../shared/domain/platform-adapter';
import { DEFAULT_MANUAL_OAUTH_DOMAINS } from '../../auth/idp-hosts';
import { resolveNewApiPageUrl } from './newapi-routes';
import { buildGitHubOAuthUrls } from './github-oauth-protocol';

/** GitHub OAuth 授权 host；与 idp-hosts 默认 manual 白名单保持一致。 */
const GITHUB_OAUTH_HOST = DEFAULT_MANUAL_OAUTH_DOMAINS[0];

export interface GitHubOAuthPlan {
  /** 手动降级时打开的站点登录页。 */
  startUrl: URL;
  oauthDomains: string[];
  redirectDomains: string[];
  /** 站点 OAuth state 接口。 */
  stateUrl: URL;
  /** 已配置的 Client ID（仅用于拼 authorize，不落日志）。 */
  clientId: string;
  siteOrigin: string;
}

/**
 * 解析 GitHub 专用流程前置条件与受信 host。
 *
 * 主进程可在账户 partition 内用 Client ID 拼装 authorize URL，
 * 跟随 GitHub 已登录会话完成站点回调；code 仅瞬态。
 * 手动降级仍打开站点官方登录页。
 */
export function resolveGitHubOAuthPlan(account: AdapterAccount): GitHubOAuthPlan | null {
  if (account.platform !== 'newapi' || !account.githubClientId?.trim()) {
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

    const probe = buildGitHubOAuthUrls(account.baseUrl, account.githubClientId, 'probe');
    if (!probe) {
      return null;
    }

    return {
      startUrl,
      oauthDomains: [GITHUB_OAUTH_HOST],
      redirectDomains: [baseUrl.hostname],
      stateUrl: new URL(probe.stateUrl),
      clientId: account.githubClientId.trim(),
      siteOrigin: baseUrl.origin,
    };
  } catch {
    return null;
  }
}
