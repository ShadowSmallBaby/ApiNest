import type { ProbeClient, ProbeResponse } from '../probe-client';
import { NewApiDetector } from './newapi-detector';

function createProbeClient(
  impl: (url: string) => Promise<ProbeResponse>,
): { probeClient: ProbeClient; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    probeClient: {
      fetchProbe: async url => {
        calls.push(url);
        return impl(url);
      },
    },
  };
}

describe('NewApiDetector', () => {
  it('detects a NewAPI site from a single probe', async () => {
    const { probeClient, calls } = createProbeClient(async () => ({
      status: 200,
      headers: {},
      bodyText: '<div id="new-api-root"></div>',
    }));

    const result = await new NewApiDetector({ probeClient }).detect('https://newapi.example.com');

    expect(result.platform).toBe('newapi');
    expect(result.confidence).toBe('high');
    expect(calls).toHaveLength(1);
  });

  it('returns unknown without throwing when the probe fails', async () => {
    const { probeClient } = createProbeClient(async () => {
      throw new Error('network down');
    });

    const result = await new NewApiDetector({ probeClient }).detect('https://newapi.example.com');

    expect(result.confidence).toBe('unknown');
    expect(result.reason).toBe('Probe request failed.');
  });

  it('returns unknown for an invalid base url without probing', async () => {
    const { probeClient, calls } = createProbeClient(async () => ({
      status: 200,
      headers: {},
      bodyText: 'new-api',
    }));

    const result = await new NewApiDetector({ probeClient }).detect('not a url');

    expect(result.confidence).toBe('unknown');
    expect(calls).toHaveLength(0);
  });
});
