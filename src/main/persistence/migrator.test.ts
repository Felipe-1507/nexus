import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { migrate, migrationsFromFiles, type Migration } from './migrator';
import { migrations as appMigrations } from './migrations';

const m1: Migration = { version: 1, name: 'a', sql: 'CREATE TABLE a (id INTEGER PRIMARY KEY);' };
const m2: Migration = { version: 2, name: 'b', sql: 'CREATE TABLE b (id INTEGER PRIMARY KEY);' };

const tables = (db: DatabaseSync) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map(
    (r) => r.name,
  );

describe('migrate', () => {
  it('aplica as migrações em ordem e registra a versão', () => {
    const db = new DatabaseSync(':memory:');
    expect(migrate(db, [m1, m2])).toEqual({ applied: [1, 2], current: 2 });
    expect(tables(db)).toEqual(['a', 'b', 'schema_migrations']);
  });

  it('é idempotente e aplica só as pendentes', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, [m1]);
    expect(migrate(db, [m1, m2])).toEqual({ applied: [2], current: 2 });
    expect(migrate(db, [m1, m2])).toEqual({ applied: [], current: 2 });
  });

  it('desfaz a migração inteira quando ela falha', () => {
    const db = new DatabaseSync(':memory:');
    const broken: Migration = {
      version: 2,
      name: 'quebrada',
      sql: 'CREATE TABLE c (id INTEGER); INSERT INTO nao_existe VALUES (1);',
    };
    migrate(db, [m1]);
    expect(() => migrate(db, [m1, broken])).toThrow(/2_quebrada/);
    expect(tables(db)).not.toContain('c');
    expect(migrate(db, [m1])).toEqual({ applied: [], current: 1 });
  });

  it('recusa banco de uma versão mais nova do app', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, [m1, m2]);
    expect(() => migrate(db, [m1])).toThrow(/versão 2/);
  });
});

describe('migrationsFromFiles', () => {
  it('ordena pelo número e exige sequência contínua', () => {
    expect(migrationsFromFiles({ './0002_b.sql': 'x', './0001_a.sql': 'y' }).map((m) => m.name)).toEqual(['a', 'b']);
    expect(() => migrationsFromFiles({ './0001_a.sql': 'x', './0003_c.sql': 'y' })).toThrow(/quebrada/);
    expect(() => migrationsFromFiles({ './init.sql': 'x' })).toThrow(/inválido/);
  });
});

describe('migrações do app', () => {
  it('aplicam do zero num banco vazio', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    const report = migrate(db, appMigrations);
    expect(report.current).toBe(appMigrations.length);
    expect(tables(db)).toContain('settings');
  });

  it('0010 mantém a ordem alfabética dos projetos e define Sonnet · Médio só para quem não escolheu', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db, appMigrations.slice(0, 9));
    const ws = (id: string, model: string | null, effort: string | null) =>
      db
        .prepare(
          `INSERT INTO workspaces (id, slug, name, color, icon, root_path, permission_mode, created_at, updated_at, default_model, default_effort)
           VALUES (?, ?, ?, 'x', 'x', ?, 'auto', 't', 't', ?, ?)`,
        )
        .run(id, id, id, id, model, effort);
    ws('w1', null, null);
    ws('w2', 'haiku', 'low');
    ws('w3', 'opus', null);
    const project = (id: string, name: string, w: string) =>
      db
        .prepare(
          `INSERT INTO projects (id, workspace_id, name, kind, path, created_at, updated_at) VALUES (?, ?, ?, 'linked', ?, 't', 't')`,
        )
        .run(id, w, name, id);
    project('p1', 'beta', 'w1');
    project('p2', 'Alfa', 'w1');
    project('p3', 'Gama', 'w1');
    project('p4', 'Zeta', 'w2');

    migrate(db, appMigrations);

    const order = db.prepare("SELECT name FROM projects WHERE workspace_id = 'w1' ORDER BY sort_order").all();
    expect(order.map((r) => r.name)).toEqual(['Alfa', 'beta', 'Gama']);
    expect(db.prepare("SELECT sort_order FROM projects WHERE id = 'p4'").get()).toEqual({ sort_order: 0 });
    const models = db.prepare('SELECT id, default_model AS m, default_effort AS e FROM workspaces ORDER BY id').all();
    expect(models.map((r) => [r.id, r.m, r.e])).toEqual([
      ['w1', 'sonnet', 'medium'],
      ['w2', 'haiku', 'low'],
      ['w3', 'opus', null],
    ]);
  });
});
