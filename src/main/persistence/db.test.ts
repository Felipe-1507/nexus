import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backupDatabase } from './db';

let dir: string;
let db: DatabaseSync;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-bkp-'));
  db = new DatabaseSync(path.join(dir, 'nexus.db'));
  db.exec("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('dado');");
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('cópia de segurança do banco', () => {
  it('copia o banco, não repete em menos de 12 horas e guarda só as 5 últimas', () => {
    const backups = path.join(dir, 'backups');
    const first = backupDatabase(db, backups, new Date('2026-01-01T10:00:00Z'))!;
    const copy = new DatabaseSync(first);
    expect(copy.prepare('SELECT v FROM t').get()).toEqual({ v: 'dado' });
    copy.close();
    expect(backupDatabase(db, backups, new Date())).toBeNull(); // arquivo recém-criado: dentro das 12 horas

    for (let i = 2; i <= 7; i++) {
      const old = new Date(`2026-01-0${i}T10:00:00Z`);
      const file = backupDatabase(db, backups, old);
      if (file) fs.utimesSync(file, new Date(Date.now() - 86_400_000 * 30), new Date(Date.now() - 86_400_000 * 30));
    }
    expect(fs.readdirSync(backups).length).toBeLessThanOrEqual(5);
  });

  it('uma pasta impossível não derruba o app', () => {
    fs.writeFileSync(path.join(dir, 'arquivo'), 'x');
    expect(backupDatabase(db, path.join(dir, 'arquivo', 'sub'))).toBeNull();
  });
});
