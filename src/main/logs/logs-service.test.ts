import { LogsService } from './logs-service';
import type { AccountEntity } from '../storage/repositories/account-repository';
import type { UsageLogPage, UsageLogQuery } from '../../shared/ipc/bridge';

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
const SITE_USER_ID = '42';
const QUERY: UsageLogQuery = { page: 1, pageSize: 50, type: 2 };

const withSiteUserId = { getSiteUserId: () => SITE_USER_ID };

function makeAccount(overrides: Partial<AccountEntity> = {}): AccountEntity {
  return {
    id: ACCOUNT_ID,
    siteId: 'site-1',
    siteName: 'Demo',
    platform: 'newapi',
    baseUrl: 'https://demo.example.com',
    displayName: 'Main',
    routeProfile: 'modern',
    authRefId: null,
    recordVersion: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const PAGE: UsageLogPage = {
  accountId: ACCOUNT_ID,
  page: 1,
  pageSize: 50,
  total: 0,
  items: [],
};

describe('LogsService', () => {
  it('resolves the account base url and delegates to the logs client', async () => {
    let capturedRequest: unknown;
    const service = new LogsService({
      accountRepository: { get: () => makeAccount() },
      authStateRepository: withSiteUserId,
      logsClient: {
        listByAccount: async request => {
          capturedRequest = request;
          return PAGE;
        },
      },
    });

    expect(await service.listByAccount(ACCOUNT_ID, QUERY)).toEqual(PAGE);
    expect(capturedRequest).toEqual({
      accountId: ACCOUNT_ID,
      baseUrl: 'https://demo.example.com',
      siteUserId: SITE_USER_ID,
      query: QUERY,
    });
  });

  it('throws ACCOUNT_NOT_FOUND for an unknown account', async () => {
    const service = new LogsService({
      accountRepository: { get: () => null },
      authStateRepository: withSiteUserId,
      logsClient: { listByAccount: async () => PAGE },
    });

    await expect(service.listByAccount(ACCOUNT_ID, QUERY)).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
  });

  it('rejects non-newapi platforms with NOT_IMPLEMENTED', async () => {
    const service = new LogsService({
      accountRepository: { get: () => makeAccount({ platform: 'sub2api' }) },
      authStateRepository: withSiteUserId,
      logsClient: { listByAccount: async () => PAGE },
    });

    await expect(service.listByAccount(ACCOUNT_ID, QUERY)).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
  });

  it('throws AUTH_METADATA_REQUIRED when site user id is missing', async () => {
    let called = false;
    const service = new LogsService({
      accountRepository: { get: () => makeAccount() },
      authStateRepository: { getSiteUserId: () => null },
      logsClient: {
        listByAccount: async () => {
          called = true;
          return PAGE;
        },
      },
    });

    await expect(service.listByAccount(ACCOUNT_ID, QUERY)).rejects.toMatchObject({ code: 'AUTH_METADATA_REQUIRED' });
    expect(called).toBe(false);
  });
});
