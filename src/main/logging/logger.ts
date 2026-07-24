import log from 'electron-log/main';

const SENSITIVE_PATTERNS: Array<[RegExp, string]> = [
  [/(authorization\s*[:=]\s*)([^&\n]+)/gi, '$1[REDACTED]'],
  [/(oauth[_-]?code\s*[:=]\s*)([^&\s,;]+)/gi, '$1[REDACTED]'],
  [/(token\s*[:=]\s*)([^&\s,;]+)/gi, '$1[REDACTED]'],
  [/(cookie\s*[:=]\s*)([^\n]+)/gi, '$1[REDACTED]'],
  [/([?&](?:token|code|access_token|refresh_token)=)([^&\s]+)/gi, '$1[REDACTED]'],
];

function redactString(value: string): string {
  return SENSITIVE_PATTERNS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    value,
  );
}

export function redactSensitiveData(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactString(value);
  }

  if (Array.isArray(value)) {
    return value.map(item => redactSensitiveData(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => {
        // 凭据与账户身份关联键统一脱敏；userid 覆盖 userId/user_id/siteUserId，uid 为独立键。
        if (/(cookie|token|authorization|secret|password|oauth|new-api-user|userid|\buid\b)/i.test(key)) {
          return [key, '[REDACTED]'];
        }

        return [key, redactSensitiveData(entryValue)];
      }),
    );
  }

  return value;
}

function serializeArgs(args: unknown[]): unknown[] {
  return args.map(item => redactSensitiveData(item));
}

log.initialize();
log.transports.file.level = 'info';
// 开发时把过程日志打到启动 Electron 的终端；生产仍写文件，控制台保持 info 便于排障。
// 敏感字段仍经 redactSensitiveData，禁止输出 cookie/code/token。
log.transports.console.level = process.env.NODE_ENV === 'production' ? 'warn' : 'info';
// 终端里一行一条，避免 electron-log 默认样式噪声。
if (log.transports.console) {
  log.transports.console.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
}

export const appLogger = {
  info(message: string, ...args: unknown[]): void {
    log.info(message, ...serializeArgs(args));
  },
  warn(message: string, ...args: unknown[]): void {
    log.warn(message, ...serializeArgs(args));
  },
  error(message: string, ...args: unknown[]): void {
    log.error(message, ...serializeArgs(args));
  },
};
