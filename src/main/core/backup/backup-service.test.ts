import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BackupService, folderStats, suggestedBackupName } from './backup-service';

let root: string;
let db: DatabaseSync;
const NOW = new Date(2026, 10, 23, 18, 30);
const NOTE = path.join('workspaces', 'ws', 'Conhecimentos', 'Nota é.md');
/** O `tar` do Windows (bsdtar) lê e extrai zip; é o verificador independente destes testes. */
const TAR = fs.existsSync('C:\\Windows\\System32\\tar.exe') ? 'C:\\Windows\\System32\\tar.exe' : 'tar';

function service(over: Partial<ConstructorParameters<typeof BackupService>[0]> = {}) {
  return new BackupService({
    db,
    userData: path.join(root, 'userData'),
    dataRoot: path.join(root, 'conteudo'),
    tmpDir: path.join(root, 'tmp'),
    now: () => NOW,
    appName: 'Nexus',
    appVersion: '1.2.3',
    ...over,
  });
}

function extract(zip: string, name: string): string {
  const out = path.join(root, name);
  fs.mkdirSync(out);
  execFileSync(TAR, ['-xf', zip, '-C', out]);
  return out;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-backup-test-'));
  fs.mkdirSync(path.join(root, 'tmp'));
  fs.mkdirSync(path.join(root, 'userData'));
  fs.writeFileSync(path.join(root, 'userData', 'preferences.json'), '{"version":1}');
  fs.mkdirSync(path.dirname(path.join(root, 'conteudo', NOTE)), { recursive: true });
  fs.writeFileSync(path.join(root, 'conteudo', NOTE), '# Olá');
  db = new DatabaseSync(path.join(root, 'userData', 'nexus.db'));
  db.exec("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('guardado');");
});
afterEach(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('nome sugerido e contagem', () => {
  it('usa o nome do app e a data', () => {
    expect(suggestedBackupName('Nexus', NOW)).toBe('nexus-backup-20261123-1830.zip');
  });

  it('conta arquivos e bytes da pasta de conteúdo', () => {
    expect(folderStats(path.join(root, 'conteudo'))).toEqual({ bytes: Buffer.byteLength('# Olá'), files: 1 });
    expect(folderStats(path.join(root, 'nao-existe'))).toEqual({ bytes: 0, files: 0 });
  });
});

describe('BackupService.export', () => {
  it('cria um zip com o banco, as preferências, o leia-me e o conteúdo sob conteudo/', async () => {
    const out = path.join(root, 'saida', 'b.zip');
    fs.mkdirSync(path.dirname(out));
    const r = await service().export(out);
    expect(r).toMatchObject({ path: out, files: 4 });
    expect(r.bytes).toBeGreaterThan(0);
    expect(fs.existsSync(`${out}.parcial`)).toBe(false);
    expect(fs.readdirSync(path.join(root, 'tmp'))).toEqual([]);

    // O banco do zip abre e tem os dados; a nota (com acento no nome) volta igual.
    const dir = extract(out, 'extraido');
    expect(fs.readdirSync(dir).sort()).toEqual(['LEIA-ME.txt', 'conteudo', 'nexus.db', 'preferences.json']);
    const copy = new DatabaseSync(path.join(dir, 'nexus.db'));
    expect(copy.prepare('SELECT v FROM t').get()).toEqual({ v: 'guardado' });
    copy.close();
    expect(fs.readFileSync(path.join(dir, 'conteudo', NOTE), 'utf8')).toBe('# Olá');
    expect(fs.readFileSync(path.join(dir, 'preferences.json'), 'utf8')).toBe('{"version":1}');
    expect(fs.readFileSync(path.join(dir, 'LEIA-ME.txt'), 'utf8')).toContain('Backup do Nexus 1.2.3');
  });

  it('com zip64 forçado o backup ainda sai íntegro', async () => {
    const out = path.join(root, 'z64.zip');
    await service({ zipLimits: { zip64Entry: 1, zip64Count: 1 } }).export(out);
    const dir = extract(out, 'extraido64');
    expect(fs.readFileSync(path.join(dir, 'conteudo', NOTE), 'utf8')).toBe('# Olá');
  });

  it('recusa destino que não é .zip e destino dentro da pasta de conteúdo', async () => {
    await expect(service().export(path.join(root, 'x.txt'))).rejects.toThrow(/\.zip/);
    await expect(service().export(path.join(root, 'conteudo', 'b.zip'))).rejects.toThrow(/fora da pasta de conteúdo/);
  });

  it('se algo falhar no meio, não deixa arquivo parcial nem pasta temporária', async () => {
    const broken = service({
      db: {
        exec: () => {
          throw new Error('disco cheio');
        },
      } as unknown as DatabaseSync,
    });
    await expect(broken.export(path.join(root, 'b.zip'))).rejects.toThrow(/disco cheio/);
    expect(fs.existsSync(path.join(root, 'b.zip'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'b.zip.parcial'))).toBe(false);
    expect(fs.readdirSync(path.join(root, 'tmp'))).toEqual([]);
  });
});
