import type { AuthState, CheckInResult, KnownPage } from '../../../shared/ipc/bridge';
import {
  AdapterAccount,
  AccountRequestContext,
  CapabilitySet,
  DetectionResult,
  PlatformAdapter,
} from '../../../shared/domain/platform-adapter';
import type { ProbeClient } from '../probe-client';
import type { SessionRequestClient } from '../session-request-client';
import { NewApiDetector } from './newapi-detector';
import { NewApiSessionValidator } from './newapi-session-validator';
import { classifyNewApiCheckIn } from './checkin';
import { buildNewApiUserHeaders } from './newapi-auth-context';
import { resolveLinuxDoOAuthPlan } from './linuxdo-oauth';
import { resolveNewApiPageUrl } from './newapi-routes';

const NEWAPI_CHECKIN_ENDPOINT = '/api/user/checkin';

export interface NewApiAdapterDependencies {
  probeClient?: ProbeClient;
  sessionClient?: SessionRequestClient;
}

/**
 * NewAPI 平台适配器（一期唯一完整实现）。
 *
 * 5.1 建立契约与能力声明；5.2 接入探测；validateSession（5.3）、
 * 用户侧查询（5.4）、快捷页确认（5.5）在后续任务填充真实逻辑。
 */
export class NewApiAdapter implements PlatformAdapter {
  readonly platform = 'newapi' as const;

  private readonly detector?: NewApiDetector;
  private readonly sessionValidator?: NewApiSessionValidator;
  private readonly sessionClient?: SessionRequestClient;

  constructor(dependencies: NewApiAdapterDependencies = {}) {
    if (dependencies.probeClient) {
      this.detector = new NewApiDetector({ probeClient: dependencies.probeClient });
    }
    if (dependencies.sessionClient) {
      this.sessionClient = dependencies.sessionClient;
      this.sessionValidator = new NewApiSessionValidator({ sessionClient: dependencies.sessionClient });
    }
  }

  async detect(baseUrl: string, useProxy?: boolean): Promise<DetectionResult> {
    // 无探测客户端时不联网，保守返回 unknown（绝不伪造为可用）。
    if (!this.detector) {
      return {
        platform: 'newapi',
        confidence: 'unknown',
        reason: 'Detection is unavailable without a probe client.',
      };
    }

    return this.detector.detect(baseUrl, useProxy);
  }

  async getCapabilities(account: AdapterAccount): Promise<CapabilitySet> {
    const pages: Partial<Record<KnownPage, true>> = {
      home: true,
      userCenter: true,
      usage: true,
      token: true,
      login: true,
    };

    return {
      embeddedLogin: true,
      linuxDoOAuth: resolveLinuxDoOAuthPlan(account) !== null,
      profile: true,
      balance: true,
      usage: true,
      models: false,
      checkIn: true,
      pages,
    };
  }

  async validateSession(context: AccountRequestContext): Promise<AuthState> {
    // 无会话客户端时不联网，保守返回 unknown（绝不伪造为可用）。
    if (!this.sessionValidator) {
      return 'unknown';
    }

    const outcome = await this.sessionValidator.validate({
      accountId: context.accountId,
      baseUrl: context.baseUrl,
      platform: context.platform,
    });

    // outcome.state 覆盖 active/expired/unknown/error，与 AuthState 成员一致。
    return outcome.state;
  }

  getPageUrl(account: AdapterAccount, page: KnownPage): URL | null {
    return resolveNewApiPageUrl(account.baseUrl, page, account.routeProfile);
  }

  async checkIn(context: AccountRequestContext): Promise<CheckInResult> {
    if (!this.sessionClient) {
      return {
        accountId: context.accountId,
        result: 'unsupported',
        message: 'Check-in is unavailable without a session client.',
      };
    }

    let url: string;
    try {
      url = new URL(NEWAPI_CHECKIN_ENDPOINT, context.baseUrl).toString();
    } catch {
      return {
        accountId: context.accountId,
        result: 'failed',
        message: 'The configured account URL is invalid.',
      };
    }

    // 缺站内用户 ID：上游 UserAuth 必然 401，直接判会话失效，避免无谓请求。
    if (!context.siteUserId) {
      return {
        accountId: context.accountId,
        result: 'session_expired',
        message: 'The account session has expired.',
      };
    }

    try {
      const response = await this.sessionClient.fetchWithSession(url, {
        partition: context.partition,
        method: 'POST',
        headers: buildNewApiUserHeaders(context.siteUserId),
      });
      const result = classifyNewApiCheckIn(response);
      return {
        accountId: context.accountId,
        result,
        message: result === 'success' ? 'Check-in completed.' : 'Check-in was not completed.',
      };
    } catch {
      return {
        accountId: context.accountId,
        result: 'failed',
        message: 'Check-in request failed.',
      };
    }
  }

  getLinuxDoLoginUrl(account: AdapterAccount): URL | null {
    return resolveLinuxDoOAuthPlan(account)?.startUrl ?? null;
  }
}
