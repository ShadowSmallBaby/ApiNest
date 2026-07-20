/**
 * 受控浏览器窗口/内嵌视图的本地状态页（纯函数，无 Electron 依赖）。
 *
 * 登录窗不注入本应用 preload，原生空白页无法展示应用 UI；
 * 用 data:text/html 状态页提供加载转圈与失败排查提示，便于用户快速处理
 * （如 Secure DNS 与 Clash TUN/fake-ip 冲突导致的 ERR_CONNECTION_CLOSED）。
 */

export interface NavigationErrorInfo {
  /** Chromium 网络错误码（负整数，如 -100 / -356）。 */
  code: number;
  /** Chromium 错误描述（如 ERR_CONNECTION_CLOSED）。 */
  description: string;
  /** 失败的目标 URL。 */
  url: string;
  /** 面向用户的标题。 */
  title: string;
  /** 一句话说明。 */
  message: string;
  /** 可操作的排查建议（有序）。 */
  tips: string[];
}

export type BrowserStatusPageMode =
  | { mode: 'loading'; url: string }
  | { mode: 'error'; error: NavigationErrorInfo };

/** 常见网络错误码 → 友好文案与排查提示。 */
export function describeNavigationError(
  errorCode: number,
  errorDescription: string,
  url: string,
): NavigationErrorInfo {
  const description = normalizeDescription(errorCode, errorDescription);
  const base = { code: errorCode, description, url };

  switch (errorCode) {
    case -100: // ERR_CONNECTION_CLOSED
      return {
        ...base,
        title: '连接被关闭',
        message: '目标站点在握手或传输过程中关闭了连接。',
        tips: [
          '若系统开启了 Clash 等 TUN 模式（尤其 fake-ip），请到应用设置关闭「安全 DNS」并重启应用。',
          '或将全局代理设为固定代理，指向 Clash 本地端口（如 127.0.0.1:7890），并在该站点开启「使用全局 Proxy」。',
          '检查 Clash 规则是否把该域名指向了不可用节点或 REJECT。',
          '也可暂时关闭 TUN，改用系统代理 / 规则模式对比。',
        ],
      };
    case -101: // ERR_CONNECTION_RESET
      return {
        ...base,
        title: '连接被重置',
        message: '对端或中间网络重置了 TCP 连接。',
        tips: [
          '检查代理节点是否可用，尝试切换节点。',
          'TUN + 安全 DNS 冲突时也会表现为重置，可先关闭安全 DNS 重试。',
          '确认目标站点本身是否可访问。',
        ],
      };
    case -102: // ERR_CONNECTION_REFUSED
      return {
        ...base,
        title: '连接被拒绝',
        message: '无法连接到目标主机或代理端口。',
        tips: [
          '若使用固定代理，请确认 Clash/代理软件已启动且端口正确。',
          '检查目标站点地址是否填写正确。',
        ],
      };
    case -106: // ERR_INTERNET_DISCONNECTED
      return {
        ...base,
        title: '网络不可用',
        message: '当前设备似乎没有可用的网络连接。',
        tips: ['检查系统网络是否连通。', '确认 VPN/代理是否意外断开。'],
      };
    case -105: // ERR_NAME_NOT_RESOLVED
    case -109: // ERR_ADDRESS_UNREACHABLE
      return {
        ...base,
        title: '无法解析或到达主机',
        message: 'DNS 解析失败，或解析到的地址不可达。',
        tips: [
          'TUN/fake-ip 环境下请关闭应用内安全 DNS，改用系统 DNS。',
          '检查域名拼写与站点 baseUrl 配置。',
          '尝试在系统浏览器打开同一地址对比。',
        ],
      };
    case -118: // ERR_CONNECTION_TIMED_OUT
      return {
        ...base,
        title: '连接超时',
        message: '在限定时间内未能完成连接。',
        tips: [
          '网络较慢或代理节点拥堵时请重试。',
          '检查代理是否选到了延迟过高的节点。',
        ],
      };
    case -200: // ERR_CERT_COMMON_NAME_INVALID 等证书类从 -200 起
    case -201:
    case -202:
    case -203:
    case -204:
    case -205:
    case -206:
    case -207:
      return {
        ...base,
        title: '证书校验失败',
        message: '目标站点 HTTPS 证书不受信任或与域名不匹配。',
        tips: [
          '确认站点地址是否使用了错误的域名或自签证书。',
          '若公司代理做了 HTTPS 解密，需在系统中信任其根证书（应用不会关闭证书校验）。',
        ],
      };
    case -324: // ERR_EMPTY_RESPONSE
      return {
        ...base,
        title: '空响应',
        message: '服务器关闭了连接且未返回任何数据。',
        tips: [
          '可能是代理或防火墙中断了请求，检查 Clash 规则与节点。',
          '关闭安全 DNS 后若使用 TUN，可再试一次。',
        ],
      };
    case -356: // ERR_QUIC_PROTOCOL_ERROR
      return {
        ...base,
        title: 'QUIC / HTTP3 协议错误',
        message: '站点通告了 HTTP/3，但 QUIC 握手失败。',
        tips: [
          '应用已默认禁用 QUIC；若仍出现请重试或检查代理是否干扰 UDP。',
          '可改走固定代理（TCP）访问该站点。',
        ],
      };
    default:
      return {
        ...base,
        title: '页面加载失败',
        message: '无法打开目标页面。',
        tips: [
          '检查网络、代理与站点地址后重试。',
          '若系统使用 Clash TUN，请关闭应用内安全 DNS 并重启，或让站点走固定代理。',
          '在系统浏览器打开同一地址，确认站点本身是否可用。',
        ],
      };
  }
}

/**
 * 生成状态页 HTML。error 模式含「重试」按钮，通过 location.href 跳回目标 URL
 * （受 will-navigate 允许集约束，仅能回到已放行的 http(s) 主机）。
 */
export function buildBrowserStatusPageHtml(input: BrowserStatusPageMode): string {
  if (input.mode === 'loading') {
    const url = escapeHtml(input.url);
    return wrapDocument(
      '正在打开…',
      `
      <div class="card">
        <div class="spinner" aria-hidden="true"></div>
        <h1>正在打开站点页面</h1>
        <p class="muted">代理或慢网下可能需要几秒，请稍候</p>
        <p class="url">${url}</p>
      </div>
      `,
    );
  }

  const { error } = input;
  const tips = error.tips.map(tip => `<li>${escapeHtml(tip)}</li>`).join('');
  const retryUrl = escapeJsString(error.url);
  return wrapDocument(
    error.title,
    `
    <div class="card card-error">
      <div class="badge">加载失败</div>
      <h1>${escapeHtml(error.title)}</h1>
      <p>${escapeHtml(error.message)}</p>
      <p class="meta"><code>${escapeHtml(error.description)}</code> · <code>${error.code}</code></p>
      <p class="url">${escapeHtml(error.url)}</p>
      <ol class="tips">${tips}</ol>
      <div class="actions">
        <button type="button" id="retry">重试</button>
      </div>
    </div>
    <script>
      document.getElementById('retry')?.addEventListener('click', function () {
        location.href = '${retryUrl}';
      });
    </script>
    `,
  );
}

/** 将 HTML 编码为 data:text/html URL，供 webContents.loadURL 使用。 */
export function toStatusPageDataUrl(html: string): string {
  // 使用 encodeURIComponent 避免 base64 依赖与非 ASCII 问题；体积可接受。
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

export function buildLoadingStatusDataUrl(url: string): string {
  return toStatusPageDataUrl(buildBrowserStatusPageHtml({ mode: 'loading', url }));
}

export function buildErrorStatusDataUrl(error: NavigationErrorInfo): string {
  return toStatusPageDataUrl(buildBrowserStatusPageHtml({ mode: 'error', error }));
}

function normalizeDescription(errorCode: number, errorDescription: string): string {
  const trimmed = errorDescription.trim();
  if (trimmed.length > 0) {
    return trimmed.startsWith('ERR_') || trimmed.startsWith('net::')
      ? trimmed.replace(/^net::/, '')
      : trimmed;
  }
  return `ERROR_${errorCode}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 写入单引号 JS 字符串字面量时的转义。 */
function escapeJsString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/</g, '\\x3c');
}

function wrapDocument(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #1b1b22;
      --card: rgba(46, 46, 58, 0.92);
      --stroke: rgba(255, 255, 255, 0.11);
      --text: #f4f4f6;
      --muted: #909099;
      --accent: #60a5fa;
      --danger: #f87171;
      --danger-soft: rgba(248, 113, 113, 0.16);
      font-family: "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: var(--bg);
      color: var(--text);
      padding: 24px;
    }
    .card {
      width: min(520px, 100%);
      background: var(--card);
      border: 1px solid var(--stroke);
      border-radius: 12px;
      padding: 28px 24px;
      text-align: center;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35);
    }
    .card-error { text-align: left; }
    h1 {
      margin: 0 0 10px;
      font-size: 1.25rem;
      font-weight: 600;
    }
    p { margin: 0 0 10px; line-height: 1.55; }
    .muted, .meta, .url { color: var(--muted); font-size: 0.9rem; }
    .url {
      word-break: break-all;
      font-family: "Cascadia Code", Consolas, monospace;
      font-size: 0.8rem;
    }
    code {
      font-family: "Cascadia Code", Consolas, monospace;
      font-size: 0.85em;
    }
    .badge {
      display: inline-block;
      margin-bottom: 12px;
      padding: 2px 8px;
      border-radius: 999px;
      background: var(--danger-soft);
      color: var(--danger);
      font-size: 0.75rem;
      font-weight: 600;
    }
    .tips {
      margin: 14px 0 18px 1.1em;
      padding: 0;
      color: var(--muted);
      font-size: 0.9rem;
    }
    .tips li { margin: 0 0 8px; }
    .actions { display: flex; gap: 10px; }
    button {
      appearance: none;
      border: 0;
      border-radius: 8px;
      padding: 10px 16px;
      background: var(--accent);
      color: #0a1220;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }
    button:hover { filter: brightness(1.05); }
    .spinner {
      width: 36px;
      height: 36px;
      margin: 0 auto 18px;
      border: 3px solid rgba(255, 255, 255, 0.15);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}
