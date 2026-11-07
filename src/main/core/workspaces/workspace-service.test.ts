import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../../persistence/migrator';
import { migrations } from '../../persistence/migrations';
import { WorkspaceService } from './workspace-service';

let dataRoot: string;
let db: DatabaseSync;
let service: WorkspaceService;

beforeEach(() => {
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ws-'));
  db = new DatabaseSync(':memory:');
  migrate(db, migrations);
  service = new WorkspaceService({ db, dataRoot });
});

afterEach(() => {
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

const base = { color: 'violet', icon: 'layers' } as const;

describe('criar', () => {
  it('cria a pasta com a estrutura padrão e registra no banco', () => {
    const ws = service.create({ name: 'Trabalho', ...base });

    expect(ws.slug).toMatch(/^trabalho-[0-9a-f]{4}$/);
    expect(ws.rootPath).toBe(path.join(dataRoot, 'workspaces', ws.slug));
    expect(ws.folderStatus).toBe('ok');
    for (const entry of ['workspace.md', 'Conhecimentos', 'Projetos', '.nexus/workspace.json']) {
      expect(fs.existsSync(path.join(ws.rootPath, entry)), entry).toBe(true);
    }
    const meta = JSON.parse(fs.readFileSync(path.join(ws.rootPath, '.nexus', 'workspace.json'), 'utf8'));
    expect(meta).toMatchObject({ id: ws.id, name: 'Trabalho' });
    expect(service.list().map((w) => w.id)).toEqual([ws.id]);
  });

  it('torna o novo Workspace o ativo', () => {
    const a = service.create({ name: 'A', ...base });
    expect(service.getActiveId()).toBe(a.id);
    const b = service.create({ name: 'B', ...base });
    expect(service.getActiveId()).toBe(b.id);
  });

  it('recusa nome repetido ignorando maiúsculas e acentos', () => {
    service.create({ name: 'Finanças', ...base });
    expect(() => service.create({ name: 'financas', ...base })).toThrow(/Já existe um Workspace/);
  });

  it('gera pasta segura para nomes reservados e acentuados', () => {
    expect(service.create({ name: 'CON', ...base }).slug).toMatch(/^con-ws-/);
    expect(service.create({ name: 'Estudos & Ideias', ...base }).slug).toMatch(/^estudos-ideias-/);
  });

  it('não deixa pasta órfã quando o registro no banco falha', () => {
    const ids = ['11111111-1111-4111-8111-111111111111', '11111111-2222-4222-8222-222222222222'];
    const fixed = new WorkspaceService({ db, dataRoot, newId: () => ids.shift()! });
    fixed.create({ name: 'Um', ...base });
    // Mesmo id → violação de PRIMARY KEY depois de criar a pasta.
    const clash = new WorkspaceService({ db, dataRoot, newId: () => '11111111-1111-4111-8111-111111111111' });
    expect(() => clash.create({ name: 'Dois', ...base })).toThrow();
    const dirs = fs.readdirSync(path.join(dataRoot, 'workspaces'));
    expect(dirs).toHaveLength(1);
  });
});

describe('editar e arquivar', () => {
  it('atualiza nome, cor e ícone sem renomear a pasta', () => {
    const ws = service.create({ name: 'Pessoal', ...base });
    const updated = service.update({ id: ws.id, name: 'Vida Pessoal', color: 'teal', icon: 'home' });
    expect(updated).toMatchObject({ name: 'Vida Pessoal', color: 'teal', icon: 'home', rootPath: ws.rootPath });
    const meta = JSON.parse(fs.readFileSync(path.join(ws.rootPath, '.nexus', 'workspace.json'), 'utf8'));
    expect(meta.name).toBe('Vida Pessoal');
  });

  it('permite trocar só a grafia do próprio nome', () => {
    const ws = service.create({ name: 'pessoal', ...base });
    expect(service.update({ id: ws.id, name: 'Pessoal' }).name).toBe('Pessoal');
  });

  it('recusa renomear para o nome de outro Workspace', () => {
    service.create({ name: 'A', ...base });
    const b = service.create({ name: 'B', ...base });
    expect(() => service.update({ id: b.id, name: 'a' })).toThrow(/Já existe/);
  });

  it('arquivar tira da lista, mantém os arquivos e troca o ativo', () => {
    const a = service.create({ name: 'A', ...base });
    const b = service.create({ name: 'B', ...base });
    service.archive(b.id);
    expect(service.list().map((w) => w.id)).toEqual([a.id]);
    expect(fs.existsSync(b.rootPath)).toBe(true);
    expect(service.getActiveId()).toBe(a.id);
    expect(() => service.get(b.id)).toThrow(/não encontrado/);
    // O nome volta a ficar disponível.
    expect(service.create({ name: 'B', ...base }).name).toBe('B');
  });

  it('sem Workspaces, não há ativo', () => {
    const a = service.create({ name: 'A', ...base });
    service.archive(a.id);
    expect(service.getActiveId()).toBeNull();
  });

  it('marca a pasta como ausente quando ela some do disco', () => {
    const ws = service.create({ name: 'A', ...base });
    fs.rmSync(ws.rootPath, { recursive: true });
    expect(service.get(ws.id).folderStatus).toBe('missing');
    expect(() => service.readInstructions(ws.id)).toThrow(/não foi encontrada/);
  });
});

describe('instruções', () => {
  it('lê e grava o workspace.md', () => {
    const ws = service.create({ name: 'Trabalho', ...base });
    const first = service.readInstructions(ws.id);
    expect(first.content).toBe('# Instruções: Trabalho\n\n');

    const saved = service.saveInstructions(ws.id, '# Regras\n- Valores em BRL\n', first.mtimeMs);
    expect(fs.readFileSync(path.join(ws.rootPath, 'workspace.md'), 'utf8')).toBe('# Regras\n- Valores em BRL\n');
    expect(service.readInstructions(ws.id)).toEqual({
      content: '# Regras\n- Valores em BRL\n',
      mtimeMs: saved.mtimeMs,
    });
  });

  it('recusa gravar por cima de uma alteração feita fora do editor', () => {
    const ws = service.create({ name: 'A', ...base });
    const loaded = service.readInstructions(ws.id);
    const file = path.join(ws.rootPath, 'workspace.md');
    fs.writeFileSync(file, 'editado no Obsidian');
    fs.utimesSync(file, new Date(), new Date(loaded.mtimeMs + 5000));

    expect(() => service.saveInstructions(ws.id, 'versão do Nexus', loaded.mtimeMs)).toThrow(/alterado fora/);
    expect(fs.readFileSync(file, 'utf8')).toBe('editado no Obsidian');
  });

  it('recria o arquivo se ele foi apagado', () => {
    const ws = service.create({ name: 'A', ...base });
    fs.rmSync(path.join(ws.rootPath, 'workspace.md'));
    const loaded = service.readInstructions(ws.id);
    expect(loaded).toEqual({ content: '', mtimeMs: 0 });
    service.saveInstructions(ws.id, 'novo', loaded.mtimeMs);
    expect(fs.readFileSync(path.join(ws.rootPath, 'workspace.md'), 'utf8')).toBe('novo');
  });

  it('recusa instruções acima do limite', () => {
    const ws = service.create({ name: 'A', ...base });
    const { mtimeMs } = service.readInstructions(ws.id);
    expect(() => service.saveInstructions(ws.id, 'x'.repeat(65 * 1024), mtimeMs)).toThrow(/limite/);
  });
});
