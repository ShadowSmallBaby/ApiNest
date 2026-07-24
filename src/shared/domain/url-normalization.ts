export function normalizeBaseUrl(input: string): string {
  const url = new URL(input);

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS URLs are supported.');
  }

  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  url.hash = '';

  if (url.pathname === '') {
    url.pathname = '/';
  }

  // 去掉所有路径的尾随斜杠（包括根路径和子路径），使 URL 归一化更统一。
  // `https://x.com/` → `https://x.com`
  // `https://x.com/api/` → `https://x.com/api`
  if (url.pathname.endsWith('/') && url.pathname.length > 1) {
    url.pathname = url.pathname.slice(0, -1);
  }

  // 特殊处理：根路径且无 query 时直接拼接，避免 `https://x.com/?` 的尾随问号
  if (url.pathname === '/' && url.search === '') {
    return `${url.protocol}//${url.host}`;
  }

  return url.toString();
}
