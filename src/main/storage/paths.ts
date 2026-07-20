import { app } from 'electron';
import { join } from 'node:path';
import { DATABASE_FILE_NAME } from './constants';

export function getUserDataPath(): string {
  return app.getPath('userData');
}

export function getDatabasePath(): string {
  return join(getUserDataPath(), DATABASE_FILE_NAME);
}
