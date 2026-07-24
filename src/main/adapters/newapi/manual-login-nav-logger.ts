/**
 * 手动登录受控窗口导航日志 + GitHub 授权确认页观察。
 *
 * 仅主进程注入；不回传 Cookie/code/state 值到 Renderer。
 * 用于排查：手动窗口落到 GitHub Reauthorization 页、点击 Authorize 后的回跳。
 */

import type { ControlledWebContentsLike } from '../../browser/browser-container';
import { appLogger } from '../../logging/logger';
import { oauthDebug } from './oauth-debug';
import {
  extractGitHubAuthorizeForm,
  isGitHubOAuthConsentPage,
  isGitHubPasswordLoginUrl,
} from './github-oauth-protocol';

export interface ManualLoginNavLoggerOptions {
  accountId: string;
  siteBaseUrl: string;
  webContents: ControlledWebContentsLike & {
    on?(event: string, listener: (...args: unknown[]) => void): void;
    // Electron WebContents 扩展事件（容器接口未全声明，运行时存在）
  };
}

export interface ManualLoginNavLoggerHandle {
  stop(): void;
}

function safeUrlParts(url: string): { host: string; path: string; hasCode: boolean; hasState: boolean } {
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      path: u.pathname,
      hasCode: u.searchParams.has('code'),
      hasState: u.searchParams.has('state'),
    };
  } catch {
    return { host: '(invalid)', path: url.slice(0, 80), hasCode: false, hasState: false };
  }
}

function classifyUrl(url: string, siteBaseUrl: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    let siteHost = '';
    try {
      siteHost = new URL(siteBaseUrl).hostname.toLowerCase();
    } catch {
      siteHost = '';
    }
    if (host === siteHost) {
      if (u.pathname.toLowerCase().includes('oauth/github')) return 'site-github-callback';
      if (u.pathname.toLowerCase().includes('oauth/linuxdo')) return 'site-linuxdo-callback';
      if (u.pathname.toLowerCase().includes('sign-in') || u.pathname.toLowerCase().includes('login')) {
        return 'site-login';
      }
      return 'site';
    }
    if (host === 'github.com' || host.endsWith('.github.com')) {
      if (isGitHubPasswordLoginUrl(url)) return 'github-login';
      if (isGitHubOAuthConsentPage(url)) return 'github-consent';
      return 'github';
    }
    if (host === 'connect.linux.do' || host === 'linux.do') return 'linuxdo';
    return 'other';
  } catch {
    return 'invalid';
  }
}

/**
 * 绑定手动登录窗口导航日志。
 * 会监听 will-navigate / did-navigate / did-navigate-in-page / did-redirect-navigation / did-finish-load。
 */
export function attachManualLoginNavLogger(
  options: ManualLoginNavLoggerOptions,
): ManualLoginNavLoggerHandle {
  const { accountId, siteBaseUrl, webContents } = options;
  let stopped = false;
  let consentLoggedForUrl: string | null = null;

  const logNav = (phase: string, url: string, extra?: Record<string, unknown>): void => {
    if (stopped) return;
    const parts = safeUrlParts(url);
    const kind = classifyUrl(url, siteBaseUrl);
    appLogger.info(
      `[手动登录] ${phase} account=${accountId} kind=${kind} host=${parts.host} path=${parts.path} hasCode=${parts.hasCode} hasState=${parts.hasState}`,
    );
    oauthDebug(`manual-nav ${phase}`, {
      accountId,
      kind,
      url,
      ...parts,
      ...extra,
    });
  };

  const onWillNavigate = (_event: unknown, url: string): void => {
    logNav('will-navigate', url);
  };
  const onDidNavigate = (_event: unknown, url: string): void => {
    logNav('did-navigate', url);
  };
  const onDidNavigateInPage = (_event: unknown, url: string): void => {
    logNav('did-navigate-in-page', url);
  };
  const onDidRedirect = (_event: unknown, url: string): void => {
    logNav('did-redirect', url);
  };
  const onDidFinishLoad = (): void => {
    if (stopped || webContents.isDestroyed()) return;
    let url = '';
    try {
      url = webContents.getURL();
    } catch {
      return;
    }
    logNav('did-finish-load', url);

    // GitHub 授权确认页：记录是否识别到 Authorize 表单（不自动点，先日志）
    if (isGitHubOAuthConsentPage(url) && consentLoggedForUrl !== url) {
      consentLoggedForUrl = url;
      void (async () => {
        try {
          const html = String(
            await webContents.executeJavaScript(
              `(() => { try { return document.documentElement.outerHTML; } catch { return ''; } })()`,
            ),
          );
          const form = extractGitHubAuthorizeForm(html);
          appLogger.info(
            `[手动登录] GitHub 授权确认页 account=${accountId} hasAuthorizeForm=${Boolean(form)} actionHost=${form ? safeUrlParts(form.action).host : 'n/a'} fieldKeys=${form ? Object.keys(form.fields).join(',') : ''}`,
          );
          oauthDebug('manual github consent page', {
            accountId,
            url,
            hasForm: Boolean(form),
            action: form?.action,
            method: form?.method,
            fieldKeys: form ? Object.keys(form.fields) : [],
            // 不打印 field 值（可能含 authenticity_token）
            htmlSnippet: html.slice(0, 1500),
          });
        } catch (error) {
          appLogger.warn(
            `[手动登录] 读取 GitHub 授权页失败 account=${accountId} error=${error instanceof Error ? error.message : String(error)}`,
          );
        }
      })();
    }
  };

  // ControlledWebContentsLike 只声明了部分事件；运行时 Electron 有完整事件
  const wc = webContents as ControlledWebContentsLike & {
    on(event: string, listener: (...args: never[]) => void): void;
    removeListener?(event: string, listener: (...args: never[]) => void): void;
  };

  wc.on('will-navigate', onWillNavigate as never);
  wc.on('did-navigate', onDidNavigate as never);
  try {
    wc.on('did-navigate-in-page', onDidNavigateInPage as never);
  } catch {
    /* 部分 stub 无此事件 */
  }
  try {
    wc.on('did-redirect-navigation', onDidRedirect as never);
  } catch {
    /* ignore */
  }
  try {
    wc.on('did-finish-load', onDidFinishLoad as never);
  } catch {
    /* ignore */
  }

  appLogger.info(`[手动登录] 导航日志已挂载 account=${accountId}`);

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      try {
        wc.removeListener?.('will-navigate', onWillNavigate as never);
        wc.removeListener?.('did-navigate', onDidNavigate as never);
        wc.removeListener?.('did-navigate-in-page', onDidNavigateInPage as never);
        wc.removeListener?.('did-redirect-navigation', onDidRedirect as never);
        wc.removeListener?.('did-finish-load', onDidFinishLoad as never);
      } catch {
        /* ignore */
      }
      appLogger.info(`[手动登录] 导航日志已卸载 account=${accountId}`);
    },
  };
}
