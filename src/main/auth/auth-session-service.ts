import { AppError } from '../../shared/ipc/errors';
import type { AuthState, PlatformType } from '../../shared/ipc/bridge';
import type { AccountRepository } from '../storage/repositories/account-repository';
import type { AccountAuthStateRepository } from '../storage/repositories/account-auth-state-repository';
import type { SessionValidator } from './session-validator';

export interface AuthSessionServiceDependencies {
  authStateRepository: Pick<AccountAuthStateRepository, 'get' | 'upsert' | 'getSiteUserId'>;
  accountRepository: Pick<AccountRepository, 'get'>;
  sessionValidator: SessionValidator;
  now?: () => string;
}

/**
 * 会话校验编排。
 *
 * 手动内嵌登录完成后（或用户主动刷新时），调用适配器校验目标站点会话，
 * 并按结果更新 `account_auth_state`。校验失败绝不被伪造为登录成功。
 */
export class AuthSessionService {
  private readonly now: () => string;

  constructor(private readonly deps: AuthSessionServiceDependencies) {
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  getAuthState(accountId: string): AuthState {
    return this.deps.authStateRepository.get(accountId)?.state ?? 'unknown';
  }

  async refreshAuthState(accountId: string): Promise<AuthState> {
    const account = this.deps.accountRepository.get(accountId);
    if (!account) {
      throw new AppError('ACCOUNT_NOT_FOUND', 'Account was not found.');
    }

    const outcome = await this.deps.sessionValidator.validate({
      accountId,
      baseUrl: account.baseUrl,
      platform: account.platform as PlatformType,
      // 站内用户 ID 为 New-Api-User 头必需；缺失时校验器直接判过期。
      siteUserId: this.deps.authStateRepository.getSiteUserId(accountId) ?? undefined,
    });

    if (outcome.state === 'error') {
      // 失败写脱敏错误摘要，但保留最近一次成功校验时间。
      const previous = this.deps.authStateRepository.get(accountId);
      this.deps.authStateRepository.upsert({
        accountId,
        state: 'error',
        lastVerifiedAt: previous?.lastVerifiedAt,
        lastErrorCode: outcome.errorCode,
        lastErrorSummary: outcome.errorSummary,
      });
      return 'error';
    }

    // active / expired / unknown：写入状态并清空 error 字段。
    // 仅在校验通过（active）时刷新最近成功校验时间。
    const previous = this.deps.authStateRepository.get(accountId);
    this.deps.authStateRepository.upsert({
      accountId,
      state: outcome.state,
      lastVerifiedAt: outcome.state === 'active' ? this.now() : previous?.lastVerifiedAt,
      lastErrorCode: undefined,
      lastErrorSummary: undefined,
    });
    return outcome.state;
  }
}
