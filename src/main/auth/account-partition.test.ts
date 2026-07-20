import { getAccountPartition } from './account-partition';

describe('getAccountPartition', () => {
  it('derives a persistent partition from the account id only', () => {
    expect(getAccountPartition('11111111-1111-4111-8111-111111111111')).toBe(
      'persist:apinest-account-11111111-1111-4111-8111-111111111111',
    );
  });

  it('produces distinct partitions for two accounts sharing a url', () => {
    const first = getAccountPartition('11111111-1111-4111-8111-111111111111');
    const second = getAccountPartition('22222222-2222-4222-8222-222222222222');

    expect(first).not.toBe(second);
  });
});
