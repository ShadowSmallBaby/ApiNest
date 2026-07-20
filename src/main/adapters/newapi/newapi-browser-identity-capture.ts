import { normalizeSiteUserId, pickSiteUserId } from './newapi-site-identity';

/**
 * NewAPI 登录窗口内的站内用户 ID 受控捕获。
 *
 * 仅由主进程在账户登录窗口存活期间运行，读取目标站点 localStorage 的固定键
 * `uid`（default 前端）与 `user`（classic 前端，取 `.id`），规范化为数字用户 ID 后持久化。
 * 红线：
 * - 固定脚本、固定键，绝不接受 Renderer 提供的脚本或键；
 * - 每次执行前校验当前页面 origin 等于账户站点 origin（OAuth 等其它域一律跳过）；
 * - 只取数字用户 ID，绝不读取/返回 access_token、Cookie 或整个 localStorage。
 */

/** 捕获所需的 WebContents 最小子集（便于注入测试替身，解耦 Electron 运行时）。 */
export interface IdentityCaptureWebContents {
  getURL(): string;
  executeJavaScript(code: string): Promise<unknown>;
  isDestroyed?(): boolean;
}

/** 捕获所需的持久化最小子集。 */
export interface SiteIdentityStore {
  getSiteUserId(accountId: string): string | null;
  upsertSiteIdentity(accountId: string, siteUserId: string, capturedAt: string): void;
}

export interface SiteIdentityCaptureOptions {
  accountId: string;
  /** 账户站点的规范化 origin（如 `https://api.example.com`）。 */
  expectedOrigin: string;
  webContents: IdentityCaptureWebContents;
  repository: SiteIdentityStore;
  /** 轮询间隔（毫秒），默认 500ms，覆盖 SPA 登录后延迟写入 localStorage 的竞态。 */
  pollIntervalMs?: number;
  /** 轮询次数上限（防御性；窗口关闭会提前 stop），默认 600（约 5 分钟）。 */
  maxAttempts?: number;
  now?: () => string;
}

/**
 * 固定提取脚本：只读 `uid` 与 `user` 两个键，读取失败静默返回空，绝不抛错影响页面。
 * 返回值为可结构化克隆的普通对象，不含任何凭据。
 */
const EXTRACTION_SCRIPT = `(() => {
  try {
    return {
      uid: window.localStorage.getItem('uid'),
      user: window.localStorage.getItem('user'),
    };
  } catch {
    return { uid: null, user: null };
  }
})()`;

interface RawCandidates {
  uid: string | null;
  user: string | null;
}

function toRawCandidates(value: unknown): RawCandidates {
  if (typeof value !== 'object' || value === null) {
    return { uid: null, user: null };
  }
  const record = value as Record<string, unknown>;
  return {
    uid: typeof record.uid === 'string' ? record.uid : null,
    user: typeof record.user === 'string' ? record.user : null,
  };
}

export interface SiteIdentityCaptureHandle {
  /** 立即尝试一次并启动轮询。 */
  start(): void;
  /** 停止轮询并释放定时器（窗口关闭时调用）。可安全重复调用。 */
  stop(): void;
}

/**
 * 创建站内用户 ID 捕获器。调用 `start()` 启动，捕获成功或 `stop()` 后不再执行。
 * 已持久化有效 ID 的账户会跳过（避免无谓覆盖）。
 */
export function createSiteIdentityCapture(
  options: SiteIdentityCaptureOptions,
): SiteIdentityCaptureHandle {
  const now = options.now ?? (() => new Date().toISOString());
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const maxAttempts = options.maxAttempts ?? 600;

  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let inFlight = false;
  let attempts = 0;

  const stop = (): void => {
    stopped = true;
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const isTargetOrigin = (): boolean => {
    try {
      return new URL(options.webContents.getURL()).origin === options.expectedOrigin;
    } catch {
      return false;
    }
  };

  const tryCapture = async (): Promise<void> => {
    if (stopped || inFlight) {
      return;
    }
    if (options.webContents.isDestroyed?.()) {
      stop();
      return;
    }
    if (attempts >= maxAttempts) {
      stop();
      return;
    }
    attempts += 1;

    // 已捕获则无需再读页面。
    if (normalizeSiteUserId(options.repository.getSiteUserId(options.accountId))) {
      stop();
      return;
    }
    if (!isTargetOrigin()) {
      return;
    }

    inFlight = true;
    try {
      const raw = toRawCandidates(await options.webContents.executeJavaScript(EXTRACTION_SCRIPT));
      const { userId } = pickSiteUserId({ uid: raw.uid, userJson: raw.user });
      if (userId) {
        options.repository.upsertSiteIdentity(options.accountId, userId, now());
        stop();
      }
    } catch {
      // 读取失败（页面卸载/权限）静默跳过，等待下一轮或窗口关闭。
    } finally {
      inFlight = false;
    }
  };

  return {
    start(): void {
      if (stopped || timer !== null) {
        return;
      }
      void tryCapture();
      timer = setInterval(() => void tryCapture(), pollIntervalMs);
    },
    stop,
  };
}
