import type { ProbeClient, ProbeResponse } from '../probe-client';
import {
  DEFAULT_QUOTA_PER_UNIT,
  NewApiStatusClient,
  parseQuotaPerUnit,
} from './newapi-status-client';

describe('parseQuotaPerUnit', () => {
  it('extracts quota_per_unit from standard NewAPI response with data wrapper', () => {
    const body = JSON.stringify({
      success: true,
      message: 'ok',
      data: {
        quota_per_unit: 500000,
        system_name: 'Test Portal',
      },
    });

    expect(parseQuotaPerUnit(body)).toBe(500000);
  });

  it('extracts quota_per_unit from top-level response without data wrapper', () => {
    const body = JSON.stringify({
      quota_per_unit: 600000,
      system_name: 'Another Portal',
    });

    expect(parseQuotaPerUnit(body)).toBe(600000);
  });

  it('falls back to DEFAULT when quota_per_unit is missing', () => {
    const body = JSON.stringify({
      success: true,
      data: {
        system_name: 'Portal Without Rate',
      },
    });

    expect(parseQuotaPerUnit(body)).toBe(DEFAULT_QUOTA_PER_UNIT);
  });

  it('falls back to DEFAULT when quota_per_unit is zero', () => {
    const body = JSON.stringify({
      data: {
        quota_per_unit: 0,
      },
    });

    expect(parseQuotaPerUnit(body)).toBe(DEFAULT_QUOTA_PER_UNIT);
  });

  it('falls back to DEFAULT when quota_per_unit is negative', () => {
    const body = JSON.stringify({
      data: {
        quota_per_unit: -500000,
      },
    });

    expect(parseQuotaPerUnit(body)).toBe(DEFAULT_QUOTA_PER_UNIT);
  });

  it('falls back to DEFAULT when quota_per_unit is NaN', () => {
    const body = JSON.stringify({
      data: {
        quota_per_unit: Number.NaN,
      },
    });

    expect(parseQuotaPerUnit(body)).toBe(DEFAULT_QUOTA_PER_UNIT);
  });

  it('falls back to DEFAULT when quota_per_unit is Infinity', () => {
    const body = JSON.stringify({
      data: {
        quota_per_unit: Number.POSITIVE_INFINITY,
      },
    });

    expect(parseQuotaPerUnit(body)).toBe(DEFAULT_QUOTA_PER_UNIT);
  });

  it('falls back to DEFAULT when quota_per_unit is a string', () => {
    const body = JSON.stringify({
      data: {
        quota_per_unit: '500000',
      },
    });

    expect(parseQuotaPerUnit(body)).toBe(DEFAULT_QUOTA_PER_UNIT);
  });

  it('falls back to DEFAULT when body is not valid JSON', () => {
    expect(parseQuotaPerUnit('not json at all')).toBe(DEFAULT_QUOTA_PER_UNIT);
  });

  it('falls back to DEFAULT when body is empty', () => {
    expect(parseQuotaPerUnit('')).toBe(DEFAULT_QUOTA_PER_UNIT);
    expect(parseQuotaPerUnit('   ')).toBe(DEFAULT_QUOTA_PER_UNIT);
  });

  it('falls back to DEFAULT when JSON is an array', () => {
    const body = JSON.stringify([{ quota_per_unit: 500000 }]);

    expect(parseQuotaPerUnit(body)).toBe(DEFAULT_QUOTA_PER_UNIT);
  });

  it('falls back to DEFAULT when JSON is a primitive', () => {
    expect(parseQuotaPerUnit(JSON.stringify(500000))).toBe(DEFAULT_QUOTA_PER_UNIT);
    expect(parseQuotaPerUnit(JSON.stringify('text'))).toBe(DEFAULT_QUOTA_PER_UNIT);
    expect(parseQuotaPerUnit(JSON.stringify(true))).toBe(DEFAULT_QUOTA_PER_UNIT);
    expect(parseQuotaPerUnit(JSON.stringify(null))).toBe(DEFAULT_QUOTA_PER_UNIT);
  });
});

describe('NewApiStatusClient', () => {
  function createFakeProbeClient(response: Partial<ProbeResponse> | Error): ProbeClient {
    return {
      fetchProbe: async () => {
        if (response instanceof Error) {
          throw response;
        }
        return {
          status: response.status ?? 200,
          headers: response.headers ?? {},
          bodyText: response.bodyText ?? '',
        };
      },
    };
  }

  it('returns parsed quota_per_unit from successful response', async () => {
    const probeClient = createFakeProbeClient({
      status: 200,
      bodyText: JSON.stringify({
        success: true,
        data: {
          quota_per_unit: 500000,
          system_name: 'Test Portal',
        },
      }),
    });

    const client = new NewApiStatusClient(probeClient);
    const result = await client.fetchStatus('https://api.example.com');

    expect(result.quotaPerUnit).toBe(500000);
  });

  it('returns DEFAULT when response body is empty', async () => {
    const probeClient = createFakeProbeClient({
      status: 200,
      bodyText: '',
    });

    const client = new NewApiStatusClient(probeClient);
    const result = await client.fetchStatus('https://api.example.com');

    expect(result.quotaPerUnit).toBe(DEFAULT_QUOTA_PER_UNIT);
  });

  it('returns DEFAULT when response is 404', async () => {
    const probeClient = createFakeProbeClient({
      status: 404,
      bodyText: 'Not Found',
    });

    const client = new NewApiStatusClient(probeClient);
    const result = await client.fetchStatus('https://api.example.com');

    expect(result.quotaPerUnit).toBe(DEFAULT_QUOTA_PER_UNIT);
  });

  it('returns DEFAULT when response is 500', async () => {
    const probeClient = createFakeProbeClient({
      status: 500,
      bodyText: 'Internal Server Error',
    });

    const client = new NewApiStatusClient(probeClient);
    const result = await client.fetchStatus('https://api.example.com');

    expect(result.quotaPerUnit).toBe(DEFAULT_QUOTA_PER_UNIT);
  });

  it('returns DEFAULT when network request throws', async () => {
    const probeClient = createFakeProbeClient(new Error('Network timeout'));

    const client = new NewApiStatusClient(probeClient);
    const result = await client.fetchStatus('https://api.example.com');

    expect(result.quotaPerUnit).toBe(DEFAULT_QUOTA_PER_UNIT);
  });

  it('returns DEFAULT when bodyText is null/undefined', async () => {
    const probeClient = createFakeProbeClient({
      status: 200,
      bodyText: undefined as unknown as string,
    });

    const client = new NewApiStatusClient(probeClient);
    const result = await client.fetchStatus('https://api.example.com');

    expect(result.quotaPerUnit).toBe(DEFAULT_QUOTA_PER_UNIT);
  });

  it('constructs correct /api/status URL from baseUrl', async () => {
    let capturedUrl: string | undefined;
    const probeClient: ProbeClient = {
      fetchProbe: async (url) => {
        capturedUrl = url;
        return {
          status: 200,
          headers: {},
          bodyText: JSON.stringify({ data: { quota_per_unit: 500000 } }),
        };
      },
    };

    const client = new NewApiStatusClient(probeClient);
    await client.fetchStatus('https://api.example.com');

    expect(capturedUrl).toBe('https://api.example.com/api/status');
  });

  it('constructs correct /api/status URL when baseUrl has trailing slash', async () => {
    let capturedUrl: string | undefined;
    const probeClient: ProbeClient = {
      fetchProbe: async (url) => {
        capturedUrl = url;
        return {
          status: 200,
          headers: {},
          bodyText: JSON.stringify({ data: { quota_per_unit: 500000 } }),
        };
      },
    };

    const client = new NewApiStatusClient(probeClient);
    await client.fetchStatus('https://api.example.com/');

    expect(capturedUrl).toBe('https://api.example.com/api/status');
  });
});
