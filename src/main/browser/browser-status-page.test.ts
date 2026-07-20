import { describe, expect, it } from 'vitest';
import {
  buildBrowserStatusPageHtml,
  buildErrorStatusDataUrl,
  buildLoadingStatusDataUrl,
  describeNavigationError,
} from './browser-status-page';

describe('browser-status-page', () => {
  it('maps CONNECTION_CLOSED to TUN / Secure DNS tips', () => {
    const info = describeNavigationError(-100, 'net::ERR_CONNECTION_CLOSED', 'https://hlwy.org/sign-in');
    expect(info.description).toBe('ERR_CONNECTION_CLOSED');
    expect(info.title).toContain('连接');
    expect(info.tips.some(tip => tip.includes('安全 DNS'))).toBe(true);
    expect(info.tips.some(tip => /TUN|Clash/i.test(tip))).toBe(true);
  });

  it('builds a loading data URL that mentions the target', () => {
    const url = buildLoadingStatusDataUrl('https://example.com/login');
    expect(url.startsWith('data:text/html')).toBe(true);
    const html = decodeURIComponent(url.replace(/^data:text\/html;charset=utf-8,/, ''));
    expect(html).toContain('正在打开站点页面');
    expect(html).toContain('https://example.com/login');
  });

  it('builds an error page with retry button and escaped content', () => {
    const info = describeNavigationError(-100, 'ERR_CONNECTION_CLOSED', 'https://a.example/x?q=1&b=2');
    const html = buildBrowserStatusPageHtml({ mode: 'error', error: info });
    expect(html).toContain('重试');
    expect(html).toContain('ERR_CONNECTION_CLOSED');
    // 展示区 URL 中的 & 应被转义；JS 重试字面量可保留原始 URL。
    expect(html).toContain('class="url">https://a.example/x?q=1&amp;b=2</p>');
    expect(html).toContain("location.href = 'https://a.example/x?q=1&b=2'");

    const dataUrl = buildErrorStatusDataUrl(info);
    expect(dataUrl.startsWith('data:text/html')).toBe(true);
  });
});
