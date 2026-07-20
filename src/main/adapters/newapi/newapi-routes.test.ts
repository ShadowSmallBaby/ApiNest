import { describe, expect, it } from 'vitest';
import { resolveNewApiPageUrl } from './newapi-routes';

const expectedRoutes = {
  modern: {
    home: '/', userCenter: '/profile', usage: '/usage-logs', token: '/keys', login: '/sign-in',
  },
  classic: {
    home: '/', userCenter: '/console/personal', usage: '/console/log', token: '/console/token', login: '/login',
  },
  'legacy-panel': {
    home: '/', userCenter: '/panel', usage: '/panel/log', token: '/panel/token', login: '/login',
  },
} as const;

describe('resolveNewApiPageUrl', () => {
  it.each(Object.entries(expectedRoutes))('resolves the %s route profile', (profile, routes) => {
    for (const [page, path] of Object.entries(routes)) {
      expect(resolveNewApiPageUrl('https://newapi.example.com/base/', page as keyof typeof routes, profile as keyof typeof expectedRoutes)?.toString())
        .toBe(new URL(path, 'https://newapi.example.com/base/').toString());
    }
  });

  it('defaults to modern routes and rejects invalid base urls', () => {
    expect(resolveNewApiPageUrl('https://newapi.example.com', 'login')?.toString())
      .toBe('https://newapi.example.com/sign-in');
    expect(resolveNewApiPageUrl('not-a-url', 'login')).toBeNull();
  });
});
