import { initialSchemaMigration } from './001-initial-schema';
import { appLockConfigMigration } from './002-app-lock-config';
import { checkinResultsIndexMigration } from './003-checkin-results-index';
import { authIdentitiesMigration } from './004-auth-identities';
import { sitesMigration } from './005-sites';
import { networkSettingsMigration } from './006-network-settings';
import { newApiUserIdentityMigration } from './007-newapi-user-identity';

export const migrations = [
  initialSchemaMigration,
  appLockConfigMigration,
  checkinResultsIndexMigration,
  authIdentitiesMigration,
  sitesMigration,
  networkSettingsMigration,
  newApiUserIdentityMigration,
];
