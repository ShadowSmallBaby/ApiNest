import type { DetectionConfidence } from '../../../shared/domain/platform-adapter';
import type { ProbeResponse } from '../probe-client';

export interface FeatureDetectionResult {
  confidence: DetectionConfidence;
  reason: string;
}

/**
 * NewAPI 强特征：稳定、可解释的标识。命中即 high 置信度。
 * 仅做只读特征匹配，不做重扫描。
 */
const STRONG_HTML_MARKERS = [
  'new-api',
  'newapi',
  'one-api', // NewAPI 源于 One API，共享大量前端标记
];

/** 弱特征：通用 API 网关迹象，不足以确证。命中即 low。 */
const WEAK_HTML_MARKERS = ['api', 'token', 'quota'];

function bodyIncludes(body: string, marker: string): boolean {
  return body.toLowerCase().includes(marker);
}

/**
 * 从一次轻量探测响应判断是否 NewAPI。
 *
 * high：命中已知强特征（header 标识或 HTML 稳定标记）。
 * low：仅命中弱特征。
 * unknown：非 2xx、空 body 或无任何特征。
 * reason 为脱敏可读说明，不含原始 body 或敏感内容。
 */
export function detectNewApiFeatures(response: ProbeResponse): FeatureDetectionResult {
  if (response.status < 200 || response.status >= 300) {
    return { confidence: 'unknown', reason: `Non-success status: ${response.status}` };
  }

  const body = response.bodyText ?? '';
  if (body.trim().length === 0) {
    return { confidence: 'unknown', reason: 'Empty response body.' };
  }

  // 强 header 特征：部分 NewAPI 实例会暴露标识性 header。
  const serverHeader = (response.headers['server'] ?? '').toLowerCase();
  const poweredBy = (response.headers['x-powered-by'] ?? '').toLowerCase();
  if (STRONG_HTML_MARKERS.some(marker => serverHeader.includes(marker) || poweredBy.includes(marker))) {
    return { confidence: 'high', reason: 'Matched a known NewAPI server header marker.' };
  }

  if (STRONG_HTML_MARKERS.some(marker => bodyIncludes(body, marker))) {
    return { confidence: 'high', reason: 'Matched a known NewAPI page marker.' };
  }

  const weakHits = WEAK_HTML_MARKERS.filter(marker => bodyIncludes(body, marker));
  if (weakHits.length >= 2) {
    return { confidence: 'low', reason: 'Matched only generic API gateway markers.' };
  }

  return { confidence: 'unknown', reason: 'No distinguishing NewAPI features found.' };
}
