/**
 * 会话校验 HTTP 端口（可注入，便于 node 测试注入替身，绝不误触真实网络）。
 *
 * 仅对账户 partition 内的已知用户态接口发一次带凭据请求，用于登录态校验或用户主动签到；
 * 不扫描多路径、不带额外敏感头。请求必须绑定账户专属 partition。
 */

export interface SessionResponse {
  status: number;
  /** 响应头，键统一小写。 */
  headers: Record<string, string>;
  /** 响应体文本，截断到安全上限，仅用于登录态判定。 */
  bodyText: string;
  /** 达到读取上限时为 true；旧替身可省略，等价于 false。 */
  truncated?: boolean;
  /** 跟随重定向后的最终 URL（若运行时提供）；不含敏感时由调用方决定是否记录 host/path。 */
  finalUrl?: string;
}

export interface SessionRequestOptions {
  /** 账户专属持久 partition，强制绑定，禁止共享 Cookie Jar。 */
  partition: string;
  /** 仅允许调用方对已确认的用户态端点明确指定请求方法。 */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /**
   * 额外请求头（键值均为字符串）。用于密钥 CRUD 与 API 测试等需要显式头的场景；
   * 绝不在此隐式注入本应用凭据，头内容完全由调用方（主进程内业务）决定。
   */
  headers?: Record<string, string>;
  /** 请求体（已序列化的字符串，如 JSON）。仅 POST/PUT/DELETE 生效。 */
  body?: string;
  /**
   * 响应体读取上限（字节/字符近似）。缺省用 SESSION_BODY_LIMIT（64KB，够登录态判定）。
   * 密钥/模型/日志列表等结构化数据可能超过默认上限，需显式放宽以免截断致 JSON 解析失败。
   */
  bodyLimit?: number;
  timeoutMs?: number;
  /** 重定向策略。敏感 API 测试必须用 manual，避免认证头跨源转发。 */
  redirect?: 'follow' | 'manual' | 'error';
}

export interface SessionRequestClient {
  fetchWithSession(url: string, options: SessionRequestOptions): Promise<SessionResponse>;
}

/** 会话校验请求默认超时（毫秒）。 */
export const DEFAULT_SESSION_TIMEOUT_MS = 8000;

/** 登录态判定读取的响应体上限（字节/字符近似）。 */
export const SESSION_BODY_LIMIT = 64 * 1024;
