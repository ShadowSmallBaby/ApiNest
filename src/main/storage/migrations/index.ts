import { initialSchemaMigration } from './001-initial-schema';
import { appLockConfigMigration } from './002-app-lock-config';
import { checkinResultsIndexMigration } from './003-checkin-results-index';
import { authIdentitiesMigration } from './004-auth-identities';
import { sitesMigration } from './005-sites';
import { networkSettingsMigration } from './006-network-settings';
import { newApiUserIdentityMigration } from './007-newapi-user-identity';
import { siteEnabledTagsMigration } from './008-site-enabled-tags';
import { accountKeysMigration } from './009-account-keys';
import { siteOAuthConfigsMigration } from './010-site-oauth-configs';
import { siteAutoLoginCheckinMigration } from './011-site-auto-login-checkin';

export const migrations = [
  initialSchemaMigration,
  appLockConfigMigration,
  checkinResultsIndexMigration,
  authIdentitiesMigration,
  sitesMigration,
  networkSettingsMigration,
  newApiUserIdentityMigration,
  siteEnabledTagsMigration,
  accountKeysMigration,
  siteOAuthConfigsMigration,
  siteAutoLoginCheckinMigration,
];
