import { DatabaseSync } from 'node:sqlite';
import { migrate, type MigrationReport } from './migrator';
import { migrations } from './migrations';

export interface Database {
  db: DatabaseSync;
  migration: MigrationReport;
  sqliteVersion: string;
}

/** Abre (ou cria) o banco local e aplica as migrações pendentes. */
export function openDatabase(file: string): Database {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
  const migration = migrate(db, migrations);
  const { v } = db.prepare('SELECT sqlite_version() AS v').get() as { v: string };
  return { db, migration, sqliteVersion: v };
}
