import fs from 'node:fs';
import path from 'node:path';
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

const BACKUP_MIN_GAP_MS = 12 * 60 * 60_000;
const BACKUP_KEEP = 5;

/**
 * Cópia de segurança do banco (`VACUUM INTO`: arquivo único e consistente, mesmo com o app usando o banco). Faz no
 * máximo uma a cada 12 horas e guarda as últimas 5. Uma falha aqui nunca impede o app de abrir.
 */
export function backupDatabase(db: DatabaseSync, dir: string, now = new Date()): string | null {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const existing = fs
      .readdirSync(dir)
      .filter((f) => /^nexus-\d{8}-\d{6}\.db$/.test(f))
      .sort();
    const last = existing.at(-1);
    if (last && now.getTime() - fs.statSync(path.join(dir, last)).mtimeMs < BACKUP_MIN_GAP_MS) return null;
    const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const target = path.join(dir, `nexus-${stamp}.db`);
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    for (const old of [...existing, path.basename(target)].slice(0, -BACKUP_KEEP))
      fs.rmSync(path.join(dir, old), { force: true });
    return target;
  } catch {
    return null;
  }
}
