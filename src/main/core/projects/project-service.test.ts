import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../../persistence/migrator';
import { migrations } from '../../persistence/migrations';
import { WorkspaceService } from '../workspaces/workspace-service';
import { ProjectService } from './project-service';

let root: string;
let db: DatabaseSync;
let workspaces: WorkspaceService;
let projects: ProjectService;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-projsvc-'));
  db = new DatabaseSync(':memory:');
  migrate(db, migrations);
  workspaces = new WorkspaceService({ db, dataRoot: path.join(root, 'conteudo') });
  projects = new ProjectService({ db, workspaces });
});
afterEach(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const base = { color: 'violet', icon: 'layers' } as const;
const repo = () => fs.mkdtempSync(path.join(root, 'repo-'));

describe('ProjectService', () => {
  it('vincula uma pasta existente e cria uma pasta gerenciada', async () => {
    const ws = workspaces.create({ name: 'Dev', ...base });
    const folder = repo();
    const linked = await projects.create({
      kind: 'linked',
      workspaceId: ws.id,
      name: 'Site',
      path: folder,
      trustConfig: false,
    });
    expect(linked).toMatchObject({ kind: 'linked', path: folder, status: 'ok', configTrust: 'none' });

    const managed = await projects.create({ kind: 'managed', workspaceId: ws.id, name: 'Rascunhos' });
    expect(managed.path.startsWith(path.join(ws.rootPath, 'Projetos', 'rascunhos-'))).toBe(true);
    expect(fs.existsSync(managed.path)).toBe(true);
    expect((await projects.list(ws.id)).map((p) => p.name)).toEqual(['Site', 'Rascunhos']);
  });

  it('guarda a ordem escolhida e coloca projetos novos no fim', async () => {
    const ws = workspaces.create({ name: 'Dev', ...base });
    const [a, b, c] = await Promise.all(
      ['Alfa', 'Beta', 'Gama'].map(async (name) => projects.create({ kind: 'managed', workspaceId: ws.id, name })),
    );
    const ids = (list: Array<{ id: string }>) => list.map((p) => p.id);
    expect(ids(await projects.list(ws.id))).toHaveLength(3);

    const reordered = await projects.reorder(ws.id, [c!.id, a!.id, b!.id]);
    expect(ids(reordered)).toEqual([c!.id, a!.id, b!.id]);
    expect(ids(await projects.list(ws.id))).toEqual([c!.id, a!.id, b!.id]);

    const d = await projects.create({ kind: 'managed', workspaceId: ws.id, name: 'Delta' });
    expect(ids(await projects.list(ws.id))).toEqual([c!.id, a!.id, b!.id, d.id]);
  });

  it('recusa uma ordem que não bate com os projetos do Workspace', async () => {
    const ws = workspaces.create({ name: 'Dev', ...base });
    const a = await projects.create({ kind: 'managed', workspaceId: ws.id, name: 'Alfa' });
    await projects.create({ kind: 'managed', workspaceId: ws.id, name: 'Beta' });
    await expect(projects.reorder(ws.id, [a.id])).rejects.toThrow('mudou');
    await expect(projects.reorder(ws.id, [a.id, a.id])).rejects.toThrow('mudou');
    await expect(projects.reorder(ws.id, [a.id, crypto.randomUUID()])).rejects.toThrow('mudou');
  });

  it('inspeciona a pasta antes de vincular', async () => {
    const ws = workspaces.create({ name: 'Dev', ...base });
    const folder = repo();
    fs.writeFileSync(path.join(folder, '.mcp.json'), '{}');
    const inspection = await projects.inspectFolder(ws.id, folder);
    expect(inspection).toMatchObject({ status: 'ok', isDirectory: true, alreadyLinked: false });
    expect(inspection.suggestedName).toBe(path.basename(folder));
    expect(inspection.configRisks).toHaveLength(1);
    expect((await projects.inspectFolder(ws.id, path.join(folder, 'nada'))).status).toBe('missing');
  });

  it('recusa pasta inexistente, repetida, nome repetido e pasta de outro Workspace', async () => {
    const ws = workspaces.create({ name: 'Dev', ...base });
    const other = workspaces.create({ name: 'Pessoal', ...base });
    const folder = repo();
    await projects.create({ kind: 'linked', workspaceId: ws.id, name: 'Site', path: folder, trustConfig: false });

    const create = (name: string, p: string) =>
      projects.create({ kind: 'linked', workspaceId: ws.id, name, path: p, trustConfig: false });
    await expect(create('X', path.join(root, 'nao-existe'))).rejects.toThrow(/não encontrada/);
    await expect(create('Outro nome', folder.toUpperCase())).rejects.toThrow(/já está vinculada/);
    await expect(create('site', repo())).rejects.toThrow(/Já existe um projeto/);
    await expect(create('Invasão', path.join(other.rootPath, 'Conhecimentos'))).rejects.toThrow(/Workspace "Pessoal"/);
  });

  it('confiança: só carrega as configurações aceitas, e pede de novo quando elas mudam', async () => {
    const ws = workspaces.create({ name: 'Dev', ...base });
    const folder = repo();
    fs.mkdirSync(path.join(folder, '.claude'));
    const settings = path.join(folder, '.claude', 'settings.json');
    fs.writeFileSync(settings, JSON.stringify({ hooks: { Stop: [{}] } }));

    const p = await projects.create({ kind: 'linked', workspaceId: ws.id, name: 'P', path: folder, trustConfig: true });
    expect(p.configTrust).toBe('trusted');
    expect((await projects.sessionSettings(p.id)).settingSources).toEqual(['user', 'project', 'local']);

    fs.writeFileSync(settings, JSON.stringify({ hooks: { Stop: [{}] }, apiKeyHelper: 'x' }));
    expect((await projects.get(p.id)).configTrust).toBe('changed');
    expect((await projects.sessionSettings(p.id)).settingSources).toEqual(['user']);

    expect((await projects.trustConfig(p.id)).configTrust).toBe('trusted');
    expect((await projects.revokeTrust(p.id)).configTrust).toBe('untrusted');
  });

  it('pasta que sumiu aparece como ausente e bloqueia a sessão', async () => {
    const ws = workspaces.create({ name: 'Dev', ...base });
    const folder = repo();
    const p = await projects.create({
      kind: 'linked',
      workspaceId: ws.id,
      name: 'P',
      path: folder,
      trustConfig: false,
    });
    fs.rmSync(folder, { recursive: true });
    expect((await projects.get(p.id)).status).toBe('missing');
    await expect(projects.sessionSettings(p.id)).rejects.toThrow(/não encontrada/);
  });

  it('instruções e arquivamento', async () => {
    const ws = workspaces.create({ name: 'Dev', ...base });
    const p = await projects.create({ kind: 'managed', workspaceId: ws.id, name: 'P' });
    expect((await projects.setInstructions(p.id, 'Use TypeScript.')).instructions).toBe('Use TypeScript.');
    await expect(projects.setInstructions(p.id, 'x'.repeat(40 * 1024))).rejects.toThrow(/limite/);
    projects.archive(p.id);
    expect(await projects.list(ws.id)).toEqual([]);
    expect(fs.existsSync(p.path)).toBe(true);
  });
});
