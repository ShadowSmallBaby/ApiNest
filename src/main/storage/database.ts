import Database from 'better-sqlite3';
import { appLogger } from '../logging/logger';
import { getDatabasePath } from './paths';

export function openDatabase(filePath = getDatabasePath()): Database.Database {
  const database = new Database(filePath);

  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');

  appLogger.info('Opened local database.', { filePath });

  return database;
}
