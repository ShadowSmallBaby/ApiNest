const ACCOUNT_PARTITION_PREFIX = 'persist:apinest-account-';
const AUTH_PARTITION_PREFIX = 'persist:apinest-auth-';

/**
 * 账户专属持久化 partition 名称。
 * 仅由不可变的 accountId（UUID）派生，绝不掺入 URL、平台或显示名等业务数据。
 */
export function getAccountPartition(accountId: string): string {
  return `${ACCOUNT_PARTITION_PREFIX}${accountId}`;
}

/**
 * auth 身份专属持久化 partition 名称。
 * 仅由不可变的 authId（UUID）派生；github/linuxdo 身份在此 partition 内登录一次并持久化，
 * 与账户 partition 及其他 auth 身份严格隔离，绝不掺入 URL、类型或标签等业务数据。
 */
export function getAuthPartition(authId: string): string {
  return `${AUTH_PARTITION_PREFIX}${authId}`;
}

/** 从账户 partition 名反推 accountId；非账户 partition 返回 null（确定性双射的逆运算）。 */
export function accountIdFromPartition(partition: string): string | null {
  return partition.startsWith(ACCOUNT_PARTITION_PREFIX)
    ? partition.slice(ACCOUNT_PARTITION_PREFIX.length)
    : null;
}

/** 从 auth partition 名反推 authId；非 auth partition 返回 null。 */
export function authIdFromPartition(partition: string): string | null {
  return partition.startsWith(AUTH_PARTITION_PREFIX)
    ? partition.slice(AUTH_PARTITION_PREFIX.length)
    : null;
}

/**
 * 平台探测专用「非持久」partition：与账户/auth partition 严格隔离，
 * direct 与 proxy 各一，避免代理探测与直连探测互相污染，也不落任何持久 Cookie。
 */
export const PROBE_DIRECT_PARTITION = 'apinest-probe-direct';
export const PROBE_PROXY_PARTITION = 'apinest-probe-proxy';
