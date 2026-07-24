import { net, session } from 'electron';
import type { SessionPartitionManager } from '../auth/session-partition-manager';
import {
  DEFAULT_SESSION_TIMEOUT_MS,
  SESSION_BODY_LIMIT,
  SessionRequestClient,
  SessionRequestOptions,
  SessionResponse,
} from './session-request-client';
import { appLogger } from '../logging/logger';
import { APINEST_OAUTH_DEBUG, oauthDebug } from './newapi/oauth-debug';

type PartitionPreparer = Pick<SessionPartitionManager, 'prepareSessionForPartition'>;

export interface ElectronSessionRequestClientDependencies {
  partitionManager: PartitionPreparer;
}

/**
 * 基于账户专属 partition session 的会话请求客户端。
 *
 * - follow：session.fetch
 * - manual：net.request + redirect 事件（fetch manual 会抛 Redirect was cancelled）
 *
 * 调试期（APINEST_OAUTH_DEBUG）输出完整 URL / 头 / body / Set-Cookie / 分区 Cookie 列表。
 */
export class ElectronSessionRequestClient implements SessionRequestClient {
  constructor(private readonly deps: ElectronSessionRequestClientDependencies) {}

  async fetchWithSession(url: string, options: SessionRequestOptions): Promise<SessionResponse> {
    await this.deps.partitionManager.prepareSessionForPartition(options.partition);
    const accountSession = session.fromPartition(options.partition);
    const timeoutMs = options.timeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;

    oauthDebug('fetch start', {
      url,
      method: options.method ?? 'GET',
      redirect: options.redirect ?? 'follow',
      partition: options.partition,
      timeoutMs,
      headers: options.headers,
      bodyPreview: options.body?.slice(0, 500),
    });

    if (options.redirect === 'manual') {
      const result = await this.fetchManualRedirect(accountSession, url, options, timeoutMs);
      await this.debugAfterResponse(accountSession, url, result);
      return result;
    }

    const result = await this.fetchFollow(accountSession, url, options, timeoutMs);
    await this.debugAfterResponse(accountSession, url, result);
    return result;
  }

  private async debugAfterResponse(
    accountSession: Electron.Session,
    requestUrl: string,
    result: SessionResponse,
  ): Promise<void> {
    if (!APINEST_OAUTH_DEBUG) {
      return;
    }
    try {
      const host = new URL(requestUrl).hostname;
      const cookies = await accountSession.cookies.get({ domain: host });
      const cookieSummary = cookies.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        expirationDate: c.expirationDate,
      }));
      oauthDebug('fetch done', {
        status: result.status,
        finalUrl: result.finalUrl,
        headerKeys: Object.keys(result.headers),
        setCookie: result.headers['set-cookie'] ?? result.headers['Set-Cookie'],
        location: result.headers.location,
        bodyLen: result.bodyText.length,
        body: result.bodyText,
        cookiesOnHost: cookieSummary,
      });
    } catch (error) {
      oauthDebug('fetch done (cookie dump failed)', {
        status: result.status,
        body: result.bodyText,
        error: String(error),
      });
    }
  }

  private async fetchFollow(
    accountSession: Electron.Session,
    url: string,
    options: SessionRequestOptions,
    timeoutMs: number,
  ): Promise<SessionResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const host = safeHost(url);

    try {
      const response = await accountSession.fetch(url, {
        method: options.method ?? 'GET',
        redirect: 'follow',
        credentials: 'include',
        ...(options.headers ? { headers: options.headers } : {}),
        ...(options.body !== undefined ? { body: options.body } : {}),
        signal: controller.signal,
      });

      const headers = headerMapFromFetch(response.headers);
      // 调试期放宽 body 上限，便于看完整 HTML
      const bodyLimit = APINEST_OAUTH_DEBUG
        ? Math.max(options.bodyLimit ?? SESSION_BODY_LIMIT, 512 * 1024)
        : (options.bodyLimit ?? SESSION_BODY_LIMIT);
      const fullText = await response.text();
      const truncated = fullText.length > bodyLimit;
      const bodyText = fullText.slice(0, bodyLimit);
      const finalUrl =
        typeof response.url === 'string' && response.url.length > 0 ? response.url : undefined;

      // 若 fetch 未自动落 Cookie，尝试把 Set-Cookie 手写进 session
      await applySetCookieHeaders(accountSession, finalUrl ?? url, headers);

      return { status: response.status, headers, bodyText, truncated, finalUrl };
    } catch (error) {
      logFetchError(host, options.method ?? 'GET', 'follow', timeoutMs, error);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private fetchManualRedirect(
    accountSession: Electron.Session,
    url: string,
    options: SessionRequestOptions,
    timeoutMs: number,
  ): Promise<SessionResponse> {
    const host = safeHost(url);
    const method = options.method ?? 'GET';

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        fn();
      };

      const timer = setTimeout(() => {
        finish(() => {
          try {
            request.abort();
          } catch {
            // ignore
          }
          const err = new Error(`Request timed out after ${timeoutMs}ms`);
          logFetchError(host, method, 'manual', timeoutMs, err);
          reject(err);
        });
      }, timeoutMs);

      let request: Electron.ClientRequest;
      try {
        request = net.request({
          method,
          url,
          session: accountSession,
          useSessionCookies: true,
        });
      } catch (error) {
        clearTimeout(timer);
        logFetchError(host, method, 'manual', timeoutMs, error);
        reject(error);
        return;
      }

      if (options.headers) {
        for (const [key, value] of Object.entries(options.headers)) {
          request.setHeader(key, value);
        }
      }

      request.on('redirect', (statusCode, _method, redirectUrl, responseHeaders) => {
        finish(() => {
          const headers = headerMapFromNodeHeaders(responseHeaders as Record<string, string | string[]>);
          headers.location = redirectUrl;
          oauthDebug('manual redirect event', {
            statusCode,
            redirectUrl,
            responseHeaders: headers,
          });
          appLogger.info(
            `[session-fetch] manual 捕获重定向 host=${host} status=${statusCode} toHost=${safeHost(redirectUrl)}`,
          );
          try {
            request.abort();
          } catch {
            // ignore
          }
          resolve({
            status: statusCode,
            headers,
            bodyText: '',
            finalUrl: redirectUrl,
          });
        });
      });

      request.on('response', response => {
        const headers = headerMapFromNodeHeaders(response.headers);
        const chunks: Buffer[] = [];
        const bodyLimit = APINEST_OAUTH_DEBUG
          ? Math.max(options.bodyLimit ?? SESSION_BODY_LIMIT, 512 * 1024)
          : (options.bodyLimit ?? SESSION_BODY_LIMIT);

        response.on('data', (chunk: Buffer) => {
          if (Buffer.concat(chunks).length < bodyLimit + 1) {
            chunks.push(chunk);
          }
        });

        response.on('end', () => {
          finish(() => {
            const fullText = Buffer.concat(chunks).toString('utf8');
            const truncated = fullText.length > bodyLimit;
            void applySetCookieHeaders(accountSession, url, headers).then(() => {
              resolve({
                status: response.statusCode,
                headers,
                bodyText: fullText.slice(0, bodyLimit),
                truncated,
                finalUrl: url,
              });
            });
          });
        });

        response.on('error', error => {
          finish(() => {
            logFetchError(host, method, 'manual', timeoutMs, error);
            reject(error);
          });
        });
      });

      request.on('error', error => {
        finish(() => {
          logFetchError(host, method, 'manual', timeoutMs, error);
          reject(error);
        });
      });

      if (options.body !== undefined && method !== 'GET') {
        request.write(options.body);
      }
      request.end();
    });
  }
}

/**
 * 将响应中的 Set-Cookie 写入 session（调试/兜底）。
 * session.fetch 理论上会自动处理；部分路径下仍可能丢失，故显式补写。
 */
async function applySetCookieHeaders(
  accountSession: Electron.Session,
  pageUrl: string,
  headers: Record<string, string>,
): Promise<void> {
  const raw =
    headers['set-cookie'] ??
    headers['Set-Cookie'] ??
    // node 风格可能把多个 cookie 合成一行
    '';
  if (!raw || raw.length === 0) {
    return;
  }

  // 可能是 "a=1; Path=/, b=2; Path=/" 或单条
  const parts = splitSetCookieHeader(raw);
  let page: URL;
  try {
    page = new URL(pageUrl);
  } catch {
    return;
  }

  for (const part of parts) {
    const parsed = parseOneSetCookie(part, page);
    if (!parsed) {
      oauthDebug('skip unparsable Set-Cookie', part);
      continue;
    }
    try {
      await accountSession.cookies.set(parsed);
      oauthDebug('cookies.set ok', parsed);
    } catch (error) {
      oauthDebug('cookies.set failed', { parsed, error: String(error) });
    }
  }
}

function splitSetCookieHeader(raw: string): string[] {
  // 粗分：按 ", " 且后面像 name= 的边界（不完美但够调试）
  const cookies: string[] = [];
  let current = '';
  for (const segment of raw.split(/,(?=\s*[^;=]+=[^;]+)/)) {
    if (current) {
      cookies.push(current.trim());
    }
    current = segment;
  }
  if (current.trim()) {
    cookies.push(current.trim());
  }
  return cookies.length > 0 ? cookies : [raw];
}

function parseOneSetCookie(
  setCookie: string,
  page: URL,
): Electron.CookiesSetDetails | null {
  const segments = setCookie.split(';').map(s => s.trim());
  const first = segments[0];
  if (!first) {
    return null;
  }
  const eq = first.indexOf('=');
  if (eq <= 0) {
    return null;
  }
  const name = first.slice(0, eq).trim();
  const value = first.slice(eq + 1).trim();
  if (!name) {
    return null;
  }

  let path = '/';
  let domain: string | undefined;
  let secure = page.protocol === 'https:';
  let httpOnly = false;
  let expirationDate: number | undefined;
  let sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict' = 'unspecified';

  for (let i = 1; i < segments.length; i += 1) {
    const seg = segments[i];
    const low = seg.toLowerCase();
    if (low.startsWith('path=')) {
      path = seg.slice(5) || '/';
    } else if (low.startsWith('domain=')) {
      domain = seg.slice(7);
    } else if (low === 'secure') {
      secure = true;
    } else if (low === 'httponly') {
      httpOnly = true;
    } else if (low.startsWith('expires=')) {
      const t = Date.parse(seg.slice(8));
      if (!Number.isNaN(t)) {
        expirationDate = Math.floor(t / 1000);
      }
    } else if (low.startsWith('max-age=')) {
      const sec = Number(seg.slice(8));
      if (Number.isFinite(sec)) {
        expirationDate = Math.floor(Date.now() / 1000) + sec;
      }
    } else if (low.startsWith('samesite=')) {
      const v = seg.slice(9).toLowerCase();
      if (v === 'lax') sameSite = 'lax';
      else if (v === 'strict') sameSite = 'strict';
      else if (v === 'none') sameSite = 'no_restriction';
    }
  }

  return {
    url: page.origin + (path.startsWith('/') ? path : `/${path}`),
    name,
    value,
    path,
    ...(domain ? { domain } : {}),
    secure,
    httpOnly,
    ...(expirationDate !== undefined ? { expirationDate } : {}),
    sameSite,
  };
}

function headerMapFromFetch(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    const k = key.toLowerCase();
    // 合并多条 set-cookie
    if (k === 'set-cookie' && result[k]) {
      result[k] = `${result[k]}, ${value}`;
    } else {
      result[k] = value;
    }
  });
  // getSetCookie 若可用更完整
  const anyHeaders = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === 'function') {
    const list = anyHeaders.getSetCookie();
    if (list.length > 0) {
      result['set-cookie'] = list.join(', ');
    }
  }
  return result;
}

function headerMapFromNodeHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }
    result[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return result;
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'invalid-url';
  }
}

function logFetchError(
  host: string,
  method: string,
  redirect: string,
  timeoutMs: number,
  error: unknown,
): void {
  const name = error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? error.message : String(error);
  appLogger.warn(
    `[session-fetch] 失败 host=${host} method=${method} redirect=${redirect} timeoutMs=${timeoutMs} error=${name}: ${message}`,
  );
  oauthDebug('fetch error full', { host, method, redirect, timeoutMs, name, message, error });
}
