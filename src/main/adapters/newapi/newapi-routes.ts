import type { KnownPage, SiteRouteProfile } from '../../../shared/ipc/bridge';

const NEWAPI_PAGE_PATHS: Record<SiteRouteProfile, Record<KnownPage, string>> = {
  modern: {
    home: '/',
    userCenter: '/profile',
    usage: '/usage-logs',
    token: '/keys',
    login: '/sign-in',
  },
  classic: {
    home: '/',
    userCenter: '/console/personal',
    usage: '/console/log',
    token: '/console/token',
    login: '/login',
  },
  'legacy-panel': {
    home: '/',
    userCenter: '/panel',
    usage: '/panel/log',
    token: '/panel/token',
    login: '/login',
  },
};

export function resolveNewApiPageUrl(
  baseUrl: string,
  page: KnownPage,
  routeProfile: SiteRouteProfile = 'modern',
): URL | null {
  try {
    return new URL(NEWAPI_PAGE_PATHS[routeProfile][page], baseUrl);
  } catch {
    return null;
  }
}
