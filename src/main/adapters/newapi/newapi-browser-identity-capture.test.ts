import { createSiteIdentityCapture } from './newapi-browser-identity-capture';

const ACCOUNT_ID = 'acc-1';
const ORIGIN = 'https://api.example.com';

/** 等待微任务与首次 tryCapture 完成（真实短延时，pollIntervalMs 设大以避免二次轮询）。 */
function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 10));
}

function makeWebContents(url: string, result: unknown) {
  let calls = 0;
  return {
    calls: () => calls,
    webContents: {
      getURL: () => url,
      executeJavaScript: async () => {
        calls += 1;
        return result;
      },
      isDestroyed: () => false,
    },
  };
}

function makeStore(existing: string | null = null) {
  const saved: { id?: string; capturedAt?: string } = {};
  let current = existing;
  return {
    saved,
    store: {
      getSiteUserId: () => current,
      upsertSiteIdentity: (_accountId: string, id: string, capturedAt: string) => {
        current = id;
        saved.id = id;
        saved.capturedAt = capturedAt;
      },
    },
  };
}

function createCapture(
  webContents: ReturnType<typeof makeWebContents>['webContents'],
  store: ReturnType<typeof makeStore>['store'],
) {
  return createSiteIdentityCapture({
    accountId: ACCOUNT_ID,
    expectedOrigin: ORIGIN,
    webContents,
    repository: store,
    pollIntervalMs: 100_000,
    now: () => '2026-07-20T00:00:00.000Z',
  });
}

describe('createSiteIdentityCapture', () => {
  it('captures uid on the target origin and persists it', async () => {
    const { webContents } = makeWebContents(`${ORIGIN}/console`, { uid: '42', user: null });
    const { store, saved } = makeStore();
    const capture = createCapture(webContents, store);

    capture.start();
    await flush();
    capture.stop();

    expect(saved.id).toBe('42');
    expect(saved.capturedAt).toBe('2026-07-20T00:00:00.000Z');
  });

  it('captures user.id from classic localStorage JSON', async () => {
    const { webContents } = makeWebContents(`${ORIGIN}/`, { uid: null, user: JSON.stringify({ id: 7 }) });
    const { store, saved } = makeStore();
    const capture = createCapture(webContents, store);

    capture.start();
    await flush();
    capture.stop();

    expect(saved.id).toBe('7');
  });

  it('does not read localStorage outside the target origin', async () => {
    const { webContents, calls } = makeWebContents('https://github.com/login', { uid: '42', user: null });
    const { store, saved } = makeStore();
    const capture = createCapture(webContents, store);

    capture.start();
    await flush();
    capture.stop();

    expect(calls()).toBe(0);
    expect(saved.id).toBeUndefined();
  });

  it('does not persist when uid and user.id conflict', async () => {
    const { webContents } = makeWebContents(`${ORIGIN}/`, { uid: '5', user: JSON.stringify({ id: 9 }) });
    const { store, saved } = makeStore();
    const capture = createCapture(webContents, store);

    capture.start();
    await flush();
    capture.stop();

    expect(saved.id).toBeUndefined();
  });

  it('does not persist an invalid uid', async () => {
    const { webContents } = makeWebContents(`${ORIGIN}/`, { uid: '0', user: null });
    const { store, saved } = makeStore();
    const capture = createCapture(webContents, store);

    capture.start();
    await flush();
    capture.stop();

    expect(saved.id).toBeUndefined();
  });

  it('skips reading when a site user id is already stored', async () => {
    const { webContents, calls } = makeWebContents(`${ORIGIN}/`, { uid: '42', user: null });
    const { store } = makeStore('7');
    const capture = createCapture(webContents, store);

    capture.start();
    await flush();
    capture.stop();

    expect(calls()).toBe(0);
  });
});
