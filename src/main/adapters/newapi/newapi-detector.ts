import type { DetectionResult } from '../../../shared/domain/platform-adapter';
import type { ProbeClient } from '../probe-client';
import { detectNewApiFeatures } from './detect';

export interface NewApiDetectorDependencies {
  probeClient: ProbeClient;
}

/**
 * NewAPI 探测编排：对 baseUrl 发一次轻量 GET，交给特征判定。
 * 网络异常、超时或无效 URL 一律归为 unknown（探测失败 ≠ 创建失败），绝不抛断。
 */
export class NewApiDetector {
  constructor(private readonly deps: NewApiDetectorDependencies) {}

  async detect(baseUrl: string, useProxy?: boolean): Promise<DetectionResult> {
    let probeUrl: string;
    try {
      probeUrl = new URL(baseUrl).toString();
    } catch {
      return { platform: 'newapi', confidence: 'unknown', reason: 'Invalid base URL.' };
    }

    try {
      const response = await this.deps.probeClient.fetchProbe(probeUrl, { useProxy });
      const features = detectNewApiFeatures(response);
      return { platform: 'newapi', confidence: features.confidence, reason: features.reason };
    } catch {
      // 不暴露原始网络错误细节；只报告不确定。
      return { platform: 'newapi', confidence: 'unknown', reason: 'Probe request failed.' };
    }
  }
}
