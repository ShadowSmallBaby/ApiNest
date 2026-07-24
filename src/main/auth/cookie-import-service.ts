/**
 * 将用户粘贴的 Cookie 写入账户专属 partition（仅目标站点 origin）。
 *
 * 2026-07-22 主人授权：允许手动导入站点 Cookie，替代仅 OAuth 路径。
 * 红线：Cookie 值不写日志、不回传 Renderer；仅主进程 set 到 Chromium session。
 */

import { AppError } from '../../shared/ipc/errors';
import type { AuthState } from '../../shared/ipc/bridge';
import type { AccountRepository } from '../storage/repositories/account-repository';
import type { SessionPartitionManager } from './session-partition-manager';
import type { CookiesSetDetailsLike } from './session-service';
import type { AuthSessionService } from './auth-session-service';
import { appLogger } from '../logging/logger';

export interface CookieImportResult {
  imported: number;
  authState: AuthState;
  message: string;
}

export interface CookieImportServiceDependencies {
  accountRepository: Pick<AccountRepository, 'get'>;
  partitionManager: Pick<SessionPartitionManager, 'getAccountSession' | 'prepareAccountSession'>;
  authSessionService: Pick<AuthSessionService, 'refreshAuthState'>;
}

/** 解析 document.cookie / 请求头风格：`a=1; b=2`（忽略空段）。 */
export function parseCookieHeaderPairs(header: string): Array<{ name: string; value: string }> {
  const pairs: Array<{ name: string; value: string }> = [];
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const name = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (name.length === 0) {
      continue;
    }
    // 拒绝疑似整段 Set-Cookie 属性行被误贴（Path/Expires 等）。
    if (/^(path|domain|expires|max-age|samesite|secure|httponly)$/i.test(name)) {
      continue;
    }
    pairs.push({ name, value });
  }
  return pairs;
}

export class CookieImportService {
  constructor(private readonly deps: CookieImportServiceDependencies) {}

  async import(accountId: string, cookieHeader: string): Promise<CookieImportResult> {
    const account = this.deps.accountRepository.get(accountId);
    if (!account) {
      throw new AppError('ACCOUNT_NOT_FOUND', 'Account was not found.');
    }

    let origin: string;
    let host: string;
    try {
      const base = new URL(account.baseUrl);
      origin = base.origin;
      host = base.hostname;
    } catch {
      throw new AppError('INVALID_ARGUMENT', 'The account URL is invalid.');
    }

    const pairs = parseCookieHeaderPairs(cookieHeader);
    if (pairs.length === 0) {
      throw new AppError('INVALID_ARGUMENT', 'No valid name=value cookie pairs found.');
    }

    await this.deps.partitionManager.prepareAccountSession(accountId);
    const accountSession = this.deps.partitionManager.getAccountSession(accountId);

    let imported = 0;
    for (const pair of pairs) {
      const details: CookiesSetDetailsLike = {
        url: origin,
        name: pair.name,
        value: pair.value,
        path: '/',
        // 站点 Cookie 默认 secure 随 https；http 本地站可 false。
        secure: origin.startsWith('https:'),
        httpOnly: false,
        domain: host,
      };
      try {
        await accountSession.cookies.set(details);
        imported += 1;
      } catch {
        // 单条失败跳过，不暴露 cookie 值。
        appLogger.warn('cookie-import: failed to set one cookie', { accountId, name: pair.name });
      }
    }

    appLogger.info('cookie-import: finished', { accountId, imported, total: pairs.length });

    let authState: AuthState = 'unknown';
    try {
      authState = await this.deps.authSessionService.refreshAuthState(accountId);
    } catch {
      authState = 'unknown';
    }

    return {
      imported,
      authState,
      message:
        imported > 0
          ? `已写入 ${imported} 条 Cookie。会话状态：${authStateLabel(authState)}。`
          : '没有可写入的 Cookie。',
    };
  }
}

function authStateLabel(state: AuthState): string {
  switch (state) {
    case 'active':
      return '有效';
    case 'expired':
      return '已过期';
    case 'error':
      return '异常';
    default:
      return '未知';
  }
}
