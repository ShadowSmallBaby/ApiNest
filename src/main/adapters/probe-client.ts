/**
 * 平台探测 HTTP 端口（可注入，便于 node 测试注入替身，绝不误触真实网络）。
 *
 * 仅用于对用户填写的 baseUrl 发一次轻量 GET 做平台识别，
 * 属"识别/打开目标站点"的必要请求；不带凭据、不发敏感头、不扫描多路径。
 */

export interface ProbeResponse {
  status: number;
  /** 响应头，键统一小写。 */
  headers: Record<string, string>;
  /** 响应体文本，截断到安全上限，仅用于特征匹配。 */
  bodyText: string;
}

export interface ProbeRequestOptions {
  timeoutMs?: number;
  /**
   * 是否让本次探测走全局 Proxy 模板（新 Site 尚未落库时用表单当前值）；默认 false（直连）。
   * 探测使用与账户/auth 隔离的非持久探测 partition，direct / proxy 各一。
   */
  useProxy?: boolean;
}

export interface ProbeClient {
  fetchProbe(url: string, options?: ProbeRequestOptions): Promise<ProbeResponse>;
}

/** 探测请求默认短超时（毫秒）。 */
export const DEFAULT_PROBE_TIMEOUT_MS = 5000;

/** 特征匹配读取的响应体上限（字节/字符近似）。 */
export const PROBE_BODY_LIMIT = 64 * 1024;
