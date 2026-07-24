import { describe, expect, it } from 'vitest';
import {
  EMPTY_SITE_FORM,
  extractLinuxDoClientId,
  normalizeFormTags,
  toCreateSiteInput,
  toUpdateSiteInput,
  validateSiteForm,
} from './site-form';

describe('site-form', () => {
  it('requires site data and the initial account', () => {
    expect(validateSiteForm(EMPTY_SITE_FORM, true)).toBe('请填写站名。');
    expect(validateSiteForm({ ...EMPTY_SITE_FORM, name: '站点', baseUrl: 'https://example.com' }, true)).toBe('请填写首个账号的显示名。');
  });

  it('maps a new NewAPI site to modern routes by default with an optional auth reference', () => {
    expect(toCreateSiteInput({
      ...EMPTY_SITE_FORM,
      name: '  主站 ',
      baseUrl: ' https://example.com ',
      firstAccountName: '  账号 A ',
      firstAuthId: 'auth-id',
      oauthConfigs: [{ provider: 'linuxdo', clientId: ' ld_client ' }],
    })).toEqual({
      name: '主站', platform: 'newapi', baseUrl: 'https://example.com', note: undefined,
      linuxDoClientId: 'ld_client', routeProfile: 'modern', useProxy: false,
      enabled: true, tags: [], autoLogin: false, autoCheckIn: false, checkInSiteUrl: undefined,
      firstAccount: { displayName: '账号 A', note: undefined, authId: 'auth-id' },
    });
  });

  it('requires oauth when autoLogin is enabled and rejects autoCheckIn with external site', () => {
    expect(validateSiteForm({
      ...EMPTY_SITE_FORM, name: '站点', baseUrl: 'https://example.com', firstAccountName: 'A',
      autoLogin: true, oauthConfigs: [],
    }, true)).toBe('启用自动登录前请先配置至少一个 OAuth Client ID。');

    expect(validateSiteForm({
      ...EMPTY_SITE_FORM, name: '站点', baseUrl: 'https://example.com', firstAccountName: 'A',
      autoCheckIn: true, checkInSiteUrl: 'https://checkin.example.com',
    }, true)).toBe('配置了额外签到站时暂不支持自动签到。');
  });

  it('forces non-NewAPI sites to the neutral modern profile', () => {
    expect(toCreateSiteInput({
      ...EMPTY_SITE_FORM, name: 'CPA', platform: 'cliproxyapi', baseUrl: 'https://cpa.example.com', routeProfile: 'classic', firstAccountName: 'A',
    }).routeProfile).toBe('modern');
  });

  it('carries enabled and normalized tags through create and update inputs', () => {
    const values = {
      ...EMPTY_SITE_FORM, name: '主站', baseUrl: 'https://example.com', firstAccountName: 'A',
      enabled: false, tags: [' 主力 ', '主力', '', '备用'],
    };
    expect(toCreateSiteInput(values)).toMatchObject({ enabled: false, tags: ['主力', '备用'] });
    expect(toUpdateSiteInput(values)).toMatchObject({ enabled: false, tags: ['主力', '备用'] });
  });

  it('normalizes tags: trims, drops blanks, dedupes in order and caps at 12', () => {
    expect(normalizeFormTags([' a ', 'a', '', 'b'])).toEqual(['a', 'b']);
    expect(normalizeFormTags(Array.from({ length: 15 }, (_, i) => `t${i}`))).toHaveLength(12);
  });

  it('extracts linuxdo client id from oauth configs for backward compatibility', () => {
    expect(extractLinuxDoClientId([
      { provider: 'github', clientId: 'gh_1' },
      { provider: 'linuxdo', clientId: ' ld_2 ' },
    ])).toBe('ld_2');
    expect(extractLinuxDoClientId([{ provider: 'github', clientId: 'gh_1' }])).toBeUndefined();
  });

  it('rejects empty or duplicate oauth configs', () => {
    expect(validateSiteForm({
      ...EMPTY_SITE_FORM,
      name: '站点',
      baseUrl: 'https://example.com',
      firstAccountName: 'A',
      oauthConfigs: [{ provider: 'github', clientId: '  ' }],
    }, true)).toBe('GitHub OAuth 的 Client ID 不能为空。');

    expect(validateSiteForm({
      ...EMPTY_SITE_FORM,
      name: '站点',
      baseUrl: 'https://example.com',
      firstAccountName: 'A',
      oauthConfigs: [
        { provider: 'github', clientId: 'a' },
        { provider: 'github', clientId: 'b' },
      ],
    }, true)).toBe('同一 OAuth 提供商只能配置一次。');
  });
});
