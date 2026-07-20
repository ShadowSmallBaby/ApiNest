import { ipcMain } from 'electron';
import { buildIpcHandlers } from './handlers';

export type IpcHandlerMap = ReturnType<typeof buildIpcHandlers>;

export function registerIpcHandlers(handlers: IpcHandlerMap = buildIpcHandlers()): void {
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (_event, ...args: unknown[]) =>
      (handler as (...handlerArgs: unknown[]) => unknown)(...args),
    );
  }
}
