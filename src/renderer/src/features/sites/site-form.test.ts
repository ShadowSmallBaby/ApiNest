import { describe, expect, it } from 'vitest';
import { EMPTY_SITE_FORM, toCreateSiteInput, validateSiteForm } from './site-form';

describe('site-form', () => {
  it('requires site data and the initial account', () => {
    expect(validateSiteForm(EMPTY_SITE_FORM, true)).toBe('请填写站名。');
    expect(validateSiteForm({ ...EMPTY_SITE_FORM, name: '站点', baseUrl: 'https://example.com' }, true)).toBe('请填写首个账号的显示名。');
  });

  it('maps a new NewAPI site to modern routes by default with an optional auth reference', () => {
    expect(toCreateSiteInput({
      ...EMPTY_SITE_FORM, name: '  主站 ', baseUrl: ' https://example.com ', firstAccountName: '  账号 A ', firstAuthId: 'auth-id',
    })).toEqual({
      name: '主站', platform: 'newapi', baseUrl: 'https://example.com', note: undefined,
      linuxDoClientId: undefined, routeProfile: 'modern', useProxy: false,
      firstAccount: { displayName: '账号 A', note: undefined, authId: 'auth-id' },
    });
  });

  it('forces non-NewAPI sites to the neutral modern profile', () => {
    expect(toCreateSiteInput({
      ...EMPTY_SITE_FORM, name: 'CPA', platform: 'cliproxyapi', baseUrl: 'https://cpa.example.com', routeProfile: 'classic', firstAccountName: 'A',
    }).routeProfile).toBe('modern');
  });
});
