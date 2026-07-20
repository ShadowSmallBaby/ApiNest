import type { PlatformType } from '../../shared/ipc/bridge';
import { AppError } from '../../shared/ipc/errors';
import type { PlatformAdapter } from '../../shared/domain/platform-adapter';
import { NewApiAdapter } from './newapi/newapi-adapter';
import { UnsupportedPlatformAdapter } from './unsupported-adapter';

/**
 * 平台适配器注册表。
 *
 * NewAPI 为一期唯一完整实现；Sub2API / CPA 注册为不支持占位。
 * 业务层通过账户平台取适配器，只依赖能力集，不散落平台判断。
 */
export class AdapterRegistry {
  private readonly adapters: Map<PlatformType, PlatformAdapter>;

  constructor(adapters?: Map<PlatformType, PlatformAdapter>) {
    this.adapters = adapters ?? AdapterRegistry.createDefaultAdapters();
  }

  private static createDefaultAdapters(): Map<PlatformType, PlatformAdapter> {
    return new Map<PlatformType, PlatformAdapter>([
      ['newapi', new NewApiAdapter()],
      ['sub2api', new UnsupportedPlatformAdapter('sub2api')],
      ['cliproxyapi', new UnsupportedPlatformAdapter('cliproxyapi')],
    ]);
  }

  get(platform: PlatformType): PlatformAdapter {
    const adapter = this.adapters.get(platform);
    if (!adapter) {
      throw new AppError('INVALID_ARGUMENT', `No adapter registered for platform: ${platform}`);
    }

    return adapter;
  }

  has(platform: PlatformType): boolean {
    return this.adapters.has(platform);
  }
}
