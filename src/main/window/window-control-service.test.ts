import { WindowControlService, type ControllableWindow } from './window-control-service';

function createFakeWindow(overrides: Partial<ControllableWindow> = {}): ControllableWindow & {
  calls: string[];
} {
  const calls: string[] = [];
  let maximized = false;

  return {
    calls,
    isMaximized: () => maximized,
    minimize: () => calls.push('minimize'),
    maximize: () => {
      maximized = true;
      calls.push('maximize');
    },
    unmaximize: () => {
      maximized = false;
      calls.push('unmaximize');
    },
    close: () => calls.push('close'),
    isDestroyed: () => false,
    ...overrides,
  };
}

describe('WindowControlService', () => {
  it('minimizes the current window', () => {
    const window = createFakeWindow();
    const service = new WindowControlService({ getWindow: () => window });

    service.minimize();

    expect(window.calls).toEqual(['minimize']);
  });

  it('toggles maximize and returns the new state', () => {
    const window = createFakeWindow();
    const service = new WindowControlService({ getWindow: () => window });

    expect(service.toggleMaximize()).toBe(true);
    expect(window.calls).toEqual(['maximize']);

    expect(service.toggleMaximize()).toBe(false);
    expect(window.calls).toEqual(['maximize', 'unmaximize']);
  });

  it('closes the current window', () => {
    const window = createFakeWindow();
    const service = new WindowControlService({ getWindow: () => window });

    service.close();

    expect(window.calls).toEqual(['close']);
  });

  it('reports maximize state', () => {
    const window = createFakeWindow({ isMaximized: () => true });
    const service = new WindowControlService({ getWindow: () => window });

    expect(service.isMaximized()).toBe(true);
  });

  it('is a no-op when there is no window', () => {
    const service = new WindowControlService({ getWindow: () => null });

    expect(() => service.minimize()).not.toThrow();
    expect(() => service.close()).not.toThrow();
    expect(service.toggleMaximize()).toBe(false);
    expect(service.isMaximized()).toBe(false);
  });

  it('treats a destroyed window as absent', () => {
    const window = createFakeWindow({ isDestroyed: () => true });
    const service = new WindowControlService({ getWindow: () => window });

    service.minimize();
    service.close();

    expect(window.calls).toEqual([]);
    expect(service.toggleMaximize()).toBe(false);
  });
});
