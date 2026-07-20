import type { AccountRecord, ModelRecord, SiteRecord, TextApiEndpoint } from '../../../../shared/ipc/bridge';

export const TEXT_ENDPOINTS: Array<{ id: TextApiEndpoint; label: string }> = [
  { id: 'openai_chat_completions', label: 'OpenAI Chat Completions' },
  { id: 'openai_responses', label: 'OpenAI Responses' },
  { id: 'anthropic_messages', label: 'Anthropic Messages' },
  { id: 'interactions', label: 'Interactions' },
  { id: 'google_generate_content', label: 'Google generateContent' },
];

export function testCapableSites(sites: SiteRecord[]): SiteRecord[] {
  return sites.filter(site => site.platform === 'newapi');
}

export function accountsForSite(accounts: AccountRecord[], siteId: string): AccountRecord[] {
  return accounts.filter(account => account.siteId === siteId);
}

export function availableModels(models: ModelRecord[]): ModelRecord[] {
  return models.filter(model => model.availableForAccount);
}

export function endpointsForModel(model: ModelRecord | undefined): TextApiEndpoint[] {
  if (!model || model.supportedEndpointTypes.length === 0) return TEXT_ENDPOINTS.map(item => item.id);
  const result = new Set<TextApiEndpoint>();
  for (const raw of model.supportedEndpointTypes) {
    const value = raw.toLowerCase();
    if (value.includes('chat/completions')) result.add('openai_chat_completions');
    if (value.includes('responses')) result.add('openai_responses');
    if (value.includes('messages')) result.add('anthropic_messages');
    if (value.includes('interactions')) result.add('interactions');
    if (value.includes('generatecontent')) result.add('google_generate_content');
  }
  return result.size > 0 ? [...result] : TEXT_ENDPOINTS.map(item => item.id);
}

export function formatResponseBody(bodyText: string, contentType?: string): string {
  if (!contentType?.toLowerCase().includes('json')) return bodyText;
  try { return JSON.stringify(JSON.parse(bodyText), null, 2); } catch { return bodyText; }
}
