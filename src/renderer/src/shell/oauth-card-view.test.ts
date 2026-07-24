import { describe, expect, it } from 'vitest';
import type { AuthIdentity } from '../../../shared/ipc/bridge';
import { buildOAuthCardView, formatCreatedAt } from './oauth-card-view';

const base: AuthIdentity = {
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'github',
  label: '我的 GitHub',
  hasCredential: false,
  useProxy: false,
  createdAt: '2026-07-22T02:23:55.000Z',
};

describe('buildOAuthCardView', () => {
  it('github：第二行为可点 host，无额外登录项，显示代理开关', () => {
    const view = buildOAuthCardView({ ...base, kind: 'github' });
    expect(view.title).toBe('GitHub · 我的 GitHub');
    expect(view.secondaryText).toBe('github.com');
    expect(view.secondaryClickable).toBe(true);
    expect(view.primaryLoginTarget).toBe('default');
    expect(view.loginActions).toEqual([]);
    expect(view.showProxyToggle).toBe(true);
    expect(view.credentialSaved).toBeNull();
  });

  it('linuxdo：第二行为 connect host，菜单额外提供主站/Credit', () => {
    const view = buildOAuthCardView({ ...base, kind: 'linuxdo', label: '论坛账号' });
    expect(view.title).toBe('LinuxDo · 论坛账号');
    expect(view.secondaryText).toBe('connect.linux.do');
    expect(view.secondaryClickable).toBe(true);
    expect(view.loginActions.map(item => item.target)).toEqual(['linuxdoMain', 'linuxdoCredit']);
    expect(view.showProxyToggle).toBe(true);
  });

  it('password：第二行为说明文字（不可点），显示凭据状态，无代理开关', () => {
    const saved = buildOAuthCardView({ ...base, kind: 'password', hasCredential: true });
    expect(saved.secondaryText).toBe('账密凭据 · 供账户引用');
    expect(saved.secondaryClickable).toBe(false);
    expect(saved.loginActions).toEqual([]);
    expect(saved.showProxyToggle).toBe(false);
    expect(saved.credentialSaved).toBe(true);

    const unsaved = buildOAuthCardView({ ...base, kind: 'password', hasCredential: false });
    expect(unsaved.credentialSaved).toBe(false);
  });
});

describe('formatCreatedAt', () => {
  it('有效 ISO 转本地字符串（与 toLocaleString 一致）', () => {
    const iso = '2026-07-22T02:23:55.000Z';
    expect(formatCreatedAt(iso)).toBe(new Date(iso).toLocaleString());
  });

  it('无效串原样返回', () => {
    expect(formatCreatedAt('not-a-date')).toBe('not-a-date');
  });
});
