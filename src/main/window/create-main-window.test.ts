import { join } from 'node:path';
import { getMainWindowOptions } from './create-main-window';

describe('getMainWindowOptions', () => {
  it('enforces secure renderer defaults', () => {
    const options = getMainWindowOptions();

    expect(options.webPreferences?.contextIsolation).toBe(true);
    expect(options.webPreferences?.sandbox).toBe(true);
    expect(options.webPreferences?.nodeIntegration).toBe(false);
    expect(options.webPreferences?.webSecurity).toBe(true);
    expect(options.webPreferences?.preload).toBe(join(__dirname, '../preload/index.js'));
  });
});
