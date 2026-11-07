import { BRAND } from '@shared/brand';
import type { DatabaseSync } from 'node:sqlite';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export interface MigrationReport {
  applied: number[];
  current: number;
}

/** Converte arquivos `NNNN_nome.sql` em migrações ordenadas e valida a sequência. */
export function migrationsFromFiles(files: Record<string, string>): Migration[] {
  const migrations = Object.entries(files).map(([file, sql]) => {
    const match = /(\d{4})_([\w-]+)\.sql$/.exec(file);
    if (!match) throw new Error(`Nome de migração inválido: ${file}`);
    return { version: Number(match[1]), name: match[2]!, sql };
  });
  migrations.sort((a, b) => a.version - b.version);
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) throw new Error(`Sequência de migrações quebrada em ${m.version}_${m.name}`);
  });
  return migrations;
}

/**
 * Aplica as migrações pendentes, cada uma em sua própria transação.
 * Recusa abrir um banco criado por uma versão mais nova do app (evita corromper dados num downgrade).
 */
export function migrate(db: DatabaseSync, migrations: Migration[]): MigrationReport {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);

  const row = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get() as { v: number };
  const known = migrations.at(-1)?.version ?? 0;
  if (row.v > known) {
    throw new Error(
      `Banco na versão ${row.v}, mas este app conhece só até a ${known}. Atualize o ${BRAND.productName}.`,
    );
  }

  const applied: number[] = [];
  const record = db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)');
  for (const m of migrations) {
    if (m.version <= row.v) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(m.sql);
      record.run(m.version, m.name, new Date().toISOString());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Falha na migração ${m.version}_${m.name}: ${(err as Error).message}`, { cause: err });
    }
    applied.push(m.version);
  }
  return { applied, current: Math.max(row.v, ...applied) };
}
