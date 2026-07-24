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

  // 去掉根路径的尾随斜杠：仅当路径为根 '/' 且无 query 时截断，
  // 使 `https://x.com/` 归一化为 `https://x.com`；非根路径（含子路径）保留原样。
  if (url.pathname === '/' && url.search === '') {
    return `${url.protocol}//${url.host}`;
  }

  return url.toString();
}
