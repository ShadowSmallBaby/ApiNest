import type { AccountRecord, ModelRecord, SiteRecord } from '../../../../shared/ipc/bridge';
import { accountsForSite, availableModels, endpointsForModel, formatResponseBody, testCapableSites } from './api-test-view';

function account(id: string, siteId: string): AccountRecord {
  return { id, siteId, siteName: siteId, platform: 'newapi', baseUrl: 'x', displayName: id, authState: 'unknown' };
}
function model(overrides: Partial<ModelRecord> = {}): ModelRecord {
  return { modelName: 'm', quotaType: 0, modelRatio: 1, completionRatio: 1, modelPrice: 0,
    enableGroups: [], supportedEndpointTypes: [], availableForAccount: true, ...overrides };
}

describe('api test view selections', () => {
  it('filters newapi sites, accounts and available models', () => {
    const sites: SiteRecord[] = [
      { id: 's1', name: 'A', platform: 'newapi', baseUrl: 'x', routeProfile: 'modern', accountCount: 1, useProxy: false, enabled: true, tags: [] },
      { id: 's2', name: 'B', platform: 'sub2api', baseUrl: 'y', routeProfile: 'modern', accountCount: 1, useProxy: false, enabled: true, tags: [] },
    ];
    expect(testCapableSites(sites).map(item => item.id)).toEqual(['s1']);
    expect(accountsForSite([account('a', 's1'), account('b', 's2')], 's1').map(item => item.id)).toEqual(['a']);
    expect(availableModels([model(), model({ modelName: 'off', availableForAccount: false })]).map(item => item.modelName)).toEqual(['m']);
  });

  it('maps known model capabilities and falls back to fixed endpoints when unknown', () => {
    expect(endpointsForModel(model({ supportedEndpointTypes: ['chat/completions', 'messages'] }))).toEqual([
      'openai_chat_completions', 'anthropic_messages',
    ]);
    expect(endpointsForModel(model({ supportedEndpointTypes: ['unknown'] }))).toHaveLength(5);
  });

  it('formats valid JSON responses and preserves plain text', () => {
    expect(formatResponseBody('{"ok":true}', 'application/json')).toBe('{\n  "ok": true\n}');
    expect(formatResponseBody('<html>', 'text/html')).toBe('<html>');
  });
});
