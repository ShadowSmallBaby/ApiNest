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

  return url.toString();
}
