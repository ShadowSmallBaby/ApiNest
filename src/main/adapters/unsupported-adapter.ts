import type { AuthState, KnownPage, PlatformType } from '../../shared/ipc/bridge';
import {
  AdapterAccount,
  AccountRequestContext,
  CapabilitySet,
  DetectionResult,
  EMPTY_CAPABILITY_SET,
  PlatformAdapter,
} from '../../shared/domain/platform-adapter';

/**
 * 未支持平台的占位适配器（Sub2API / CPA）。
 *
 * 一期仅注册为扩展占位：探测返回 unknown、无任何能力、会话校验恒为 unknown，
 * 不提供任何已知页面。绝不伪造可用状态。
 */
export class UnsupportedPlatformAdapter implements PlatformAdapter {
  constructor(public readonly platform: PlatformType) {}

  async detect(): Promise<DetectionResult> {
    return {
      platform: this.platform,
      confidence: 'unknown',
      reason: `Platform ${this.platform} is not supported in this release.`,
    };
  }

  async getCapabilities(): Promise<CapabilitySet> {
    return { ...EMPTY_CAPABILITY_SET, pages: {} };
  }

  async validateSession(_context: AccountRequestContext): Promise<AuthState> {
    return 'unknown';
  }

  getPageUrl(_account: AdapterAccount, _page: KnownPage): URL | null {
    return null;
  }
}
