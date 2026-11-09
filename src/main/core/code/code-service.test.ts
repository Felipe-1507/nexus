import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../../persistence/migrator';
import { migrations } from '../../persistence/migrations';
import { ProjectService } from '../projects/project-service';
import { WorkspaceService } from '../workspaces/workspace-service';
import { CodeService } from './code-service';
import { cleanLinkTarget, FileOpener } from './file-opener';

let root: string;
let db: DatabaseSync;
let workspaces: WorkspaceService;
let projects: ProjectService;
let code: CodeService;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-code-'));
  db = new DatabaseSync(':memory:');
  migrate(db, migrations);
  workspaces = new WorkspaceService({ db, dataRoot: path.join(root, 'conteudo') });
  projects = new ProjectService({ db, workspaces });
  code = new CodeService({ workspaces, projects });
});
afterEach(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const base = { color: 'violet', icon: 'layers' } as const;

async function setup() {
  const ws = workspaces.create({ name: 'Dev', ...base });
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'node_modules', 'x'), { recursive: true });
  fs.mkdirSync(path.join(repo, '.git'));
  fs.writeFileSync(path.join(repo, 'src', 'app.ts'), 'export const porta = 3000;\n');
  fs.writeFileSync(path.join(repo, 'README.md'), '# Repo');
  fs.writeFileSync(path.join(repo, '.env'), 'SEGREDO=1');
  fs.writeFileSync(path.join(repo, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 1]));
  const project = await projects.create({
    kind: 'linked',
    workspaceId: ws.id,
    name: 'Repo',
    path: repo,
    trustConfig: false,
  });
  return { ws, repo, scope: { workspaceId: ws.id, projectId: project.id } };
}

describe('CodeService', () => {
  it('lista pastas primeiro e esconde .git e node_modules', async () => {
    const { scope } = await setup();
    expect((await code.list(scope, '')).map((e) => `${e.type}:${e.name}`)).toEqual([
      'dir:src',
      'file:.env',
      'file:logo.png',
      'file:README.md',
    ]);
    expect(await code.list(scope, 'src')).toEqual([{ name: 'app.ts', path: 'src/app.ts', type: 'file', size: null }]);
  });

  describe('colar e excluir', () => {
    const trashed: string[] = [];
    let editable: CodeService;
    let outside: string;
    beforeEach(() => {
      trashed.length = 0;
      outside = path.join(root, 'fora');
      fs.mkdirSync(path.join(outside, 'pasta', 'sub'), { recursive: true });
      fs.writeFileSync(path.join(outside, 'nota.txt'), 'oi');
      fs.writeFileSync(path.join(outside, 'pasta', 'a.txt'), 'a');
      fs.writeFileSync(path.join(outside, 'pasta', 'sub', 'b.txt'), 'b');
      editable = new CodeService({
        workspaces,
        projects,
        trash: async (target) => {
          trashed.push(target);
        },
        protectedDirs: [path.join(root, 'app-dados')],
      });
    });

    it('copia arquivos e pastas inteiras para a pasta escolhida, sem sobrescrever', async () => {
      const { scope, repo } = await setup();
      const first = await editable.importPaths(scope, 'src', [
        path.join(outside, 'nota.txt'),
        path.join(outside, 'pasta'),
      ]);
      expect(first.imported).toEqual(['src/nota.txt', 'src/pasta']);
      expect(fs.readFileSync(path.join(repo, 'src', 'pasta', 'sub', 'b.txt'), 'utf8')).toBe('b');
      expect((await editable.list(scope, 'src')).map((e) => e.name)).toEqual(['pasta', 'app.ts', 'nota.txt']);

      // Colar de novo cria cópias; nada é sobrescrito.
      fs.writeFileSync(path.join(repo, 'src', 'nota.txt'), 'alterada');
      const again = await editable.importPaths(scope, 'src', [path.join(outside, 'nota.txt')]);
      const third = await editable.importPaths(scope, 'src', [path.join(outside, 'nota.txt')]);
      expect(again.imported).toEqual(['src/nota - cópia.txt']);
      expect(third.imported).toEqual(['src/nota - cópia 2.txt']);
      expect(fs.readFileSync(path.join(repo, 'src', 'nota.txt'), 'utf8')).toBe('alterada');
      const raiz = await editable.importPaths(scope, '', [path.join(outside, 'pasta')]);
      expect(raiz.imported).toEqual(['pasta']);
    });

    it('recusa destino fora da pasta, origem inexistente, relativa, do app e pasta dentro dela mesma', async () => {
      const { scope, repo } = await setup();
      const nota = path.join(outside, 'nota.txt');
      await expect(editable.importPaths(scope, '../..', [nota])).rejects.toMatchObject({ code: 'VALIDATION' });
      await expect(editable.importPaths(scope, 'nao-existe', [nota])).rejects.toMatchObject({ code: 'VALIDATION' });
      await expect(editable.importPaths(scope, '', [path.join(outside, 'nada.txt')])).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(editable.importPaths(scope, '', ['nota.txt'])).rejects.toMatchObject({ code: 'VALIDATION' });

      fs.mkdirSync(path.join(root, 'app-dados'));
      fs.writeFileSync(path.join(root, 'app-dados', 'nexus.db'), 'segredo');
      await expect(editable.importPaths(scope, '', [path.join(root, 'app-dados', 'nexus.db')])).rejects.toThrow('app');
      expect(fs.existsSync(path.join(repo, 'nexus.db'))).toBe(false);

      await expect(editable.importPaths(scope, 'src', [repo])).rejects.toThrow('dentro dela mesma');
    });

    it('copia dentro da árvore, renomeia e mostra no Explorer', async () => {
      const { scope, repo } = await setup();
      const shown: string[] = [];
      const svc = new CodeService({ workspaces, projects, reveal: (t) => shown.push(t) });
      expect((await svc.copyEntries(scope, 'src', ['src/app.ts'])).imported).toEqual(['src/app - cópia.ts']);
      expect(fs.existsSync(path.join(repo, 'src', 'app - cópia.ts'))).toBe(true);

      expect(await svc.rename(scope, 'src/app.ts', 'main.ts')).toEqual({ path: 'src/main.ts' });
      expect(fs.existsSync(path.join(repo, 'src', 'main.ts'))).toBe(true);
      await expect(svc.rename(scope, 'src/main.ts', 'app - cópia.ts')).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(svc.rename(scope, 'src/main.ts', 'a/b')).rejects.toMatchObject({ code: 'VALIDATION' });
      await expect(svc.rename(scope, 'src/main.ts', '..')).rejects.toMatchObject({ code: 'VALIDATION' });
      await expect(svc.rename(scope, '.', 'x')).rejects.toThrow('raiz');
      await expect(svc.rename(scope, 'nada.txt', 'x')).rejects.toMatchObject({ code: 'NOT_FOUND' });

      await svc.reveal(scope, 'src');
      await svc.reveal(scope, '');
      expect(shown).toEqual([path.join(repo, 'src'), repo]);
      await expect(code.reveal(scope, 'src')).rejects.toMatchObject({ code: 'VALIDATION' });
    });

    it('manda para a Lixeira, recusa a raiz e caminhos fora da pasta', async () => {
      const { scope, repo } = await setup();
      await editable.remove(scope, 'src/app.ts');
      expect(trashed).toEqual([path.join(repo, 'src', 'app.ts')]);
      await expect(editable.remove(scope, '..')).rejects.toMatchObject({ code: 'VALIDATION' });
      await expect(editable.remove(scope, '.')).rejects.toThrow('raiz');
      await expect(editable.remove(scope, 'nao-existe.txt')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(code.remove(scope, 'README.md')).rejects.toMatchObject({ code: 'VALIDATION' });
      expect(trashed).toHaveLength(1);
    });
  });

  it('lê texto, recusa binário e grava com detecção de conflito', async () => {
    const { scope, repo } = await setup();
    const file = await code.read(scope, 'src/app.ts');
    expect(file).toMatchObject({ content: 'export const porta = 3000;\n', reason: null });
    expect(await code.read(scope, 'logo.png')).toMatchObject({ content: null, reason: 'binary' });

    await code.write(scope, 'src/app.ts', 'export const porta = 8080;\n', file.mtimeMs);
    expect(fs.readFileSync(path.join(repo, 'src', 'app.ts'), 'utf8')).toContain('8080');
    await expect(code.write(scope, 'src/app.ts', 'x', file.mtimeMs - 10_000)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('não sai da pasta do escopo, nem por junction', async () => {
    const { scope, repo } = await setup();
    fs.writeFileSync(path.join(root, 'fora.txt'), 'segredo');
    fs.mkdirSync(path.join(root, 'fora'));
    fs.symlinkSync(path.join(root, 'fora'), path.join(repo, 'atalho'), 'junction');
    await expect(code.read(scope, '../fora.txt')).rejects.toThrow(/fora da pasta/);
    await expect(code.read(scope, 'C:/Windows/win.ini')).rejects.toThrow(/fora da pasta/);
    await expect(code.list(scope, 'atalho')).rejects.toThrow(/fora da pasta/);
    expect((await code.list(scope, '')).some((e) => e.name === 'atalho')).toBe(false);
  });

  it('escopo do Workspace e projeto de outro Workspace', async () => {
    const { scope } = await setup();
    const other = workspaces.create({ name: 'Outro', ...base });
    expect((await code.list({ workspaceId: other.id, projectId: null }, '')).map((e) => e.name)).toContain(
      'workspace.md',
    );
    await expect(code.list({ workspaceId: other.id, projectId: scope.projectId }, '')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('endereço do VS Code só para caminhos do escopo', async () => {
    const { scope, repo } = await setup();
    expect(await code.vscodeUrl(scope, 'src/app.ts')).toBe(
      `vscode://file/${encodeURI(path.join(repo, 'src', 'app.ts').split(path.sep).join('/'))}`,
    );
    await expect(code.vscodeUrl(scope, '../fora.txt')).rejects.toThrow();
    expect(await code.relativeTo(scope, path.join(repo, 'src', 'app.ts'))).toBe('src/app.ts');
    expect(await code.relativeTo(scope, path.join(root, 'fora.txt'))).toBeNull();
  });
});

describe('abrir arquivo citado pelo Claude', () => {
  function opener() {
    const reveal: string[] = [];
    const folders: string[] = [];
    const files = new FileOpener({
      workspaces,
      code,
      reveal: (f) => reveal.push(f),
      openFolder: async (d) => (folders.push(d), ''),
    });
    return { files, reveal, folders };
  }

  it('arquivo de texto do projeto abre no Nexus; o caminho pode ser absoluto, relativo ou ter linha', async () => {
    const { repo, scope } = await setup();
    const { files, reveal } = opener();
    const abs = path.join(repo, 'src', 'app.ts');
    expect(await files.open(scope, abs)).toEqual({ action: 'code', path: 'src/app.ts' });
    expect(await files.open(scope, `${abs}:12:5`)).toEqual({ action: 'code', path: 'src/app.ts' });
    expect(await files.open(scope, 'src/app.ts#L3')).toEqual({ action: 'code', path: 'src/app.ts' });
    expect(await files.open(scope, `<${abs}>`)).toEqual({ action: 'code', path: 'src/app.ts' });
    expect(await files.open(scope, `file:///${abs.replace(/\\/g, '/')}`)).toEqual({
      action: 'code',
      path: 'src/app.ts',
    });
    expect(reveal).toEqual([]);
  });

  it('o que não é texto (imagem, planilha, PDF) é mostrado no Explorer, e pasta é aberta', async () => {
    const { repo, scope } = await setup();
    fs.writeFileSync(path.join(repo, 'Relatorio.xlsx'), 'x');
    const { files, reveal, folders } = opener();
    expect(await files.open(scope, path.join(repo, 'logo.png'))).toEqual({ action: 'revealed', path: null });
    expect(await files.open(scope, 'Relatorio.xlsx')).toEqual({ action: 'revealed', path: null });
    expect(reveal).toEqual([path.join(repo, 'logo.png'), path.join(repo, 'Relatorio.xlsx')]);
    expect(await files.open(scope, 'src')).toEqual({ action: 'revealed', path: null });
    expect(folders).toEqual([path.join(repo, 'src')]);
  });

  it('nota .md do vault do Workspace abre na aba Nota', async () => {
    const { ws, scope } = await setup();
    const note = path.join(ws.knowledgeDir, 'Processos', 'Fechamento.md');
    fs.mkdirSync(path.dirname(note), { recursive: true });
    fs.writeFileSync(note, '# Fechamento');
    expect(await opener().files.open(scope, note)).toEqual({ action: 'note', path: 'Processos/Fechamento.md' });
  });

  it('recusa o que está fora das pastas do projeto e do Workspace, e o que não existe', async () => {
    const { scope } = await setup();
    const { files, reveal } = opener();
    const outside = path.join(root, 'fora.txt');
    fs.writeFileSync(outside, 'segredo');
    await expect(files.open(scope, outside)).rejects.toThrow(/fora das pastas/);
    await expect(files.open(scope, '..\\..\\fora.txt')).rejects.toThrow(/fora das pastas/);
    await expect(files.open(scope, 'src/nao-existe.ts')).rejects.toThrow(/não encontrado/);
    expect(reveal).toEqual([]);
  });

  it('limpa o que o Claude acrescenta ao caminho', () => {
    expect(cleanLinkTarget('C:\\Dev\\app\\a.ts:10')).toBe('C:\\Dev\\app\\a.ts');
    expect(cleanLinkTarget('src/a.ts:10:4')).toBe('src/a.ts');
    expect(cleanLinkTarget('src/a.ts#L10-L20')).toBe('src/a.ts');
    expect(cleanLinkTarget('<src/Minha%20Nota.md>')).toBe('src/Minha Nota.md');
    expect(cleanLinkTarget('file:///C:/Dev/a.ts')).toBe('C:/Dev/a.ts');
    expect(cleanLinkTarget('file://servidor/pasta/a.ts')).toBe('//servidor/pasta/a.ts');
    expect(cleanLinkTarget('C:\\Dev\\a.ts')).toBe('C:\\Dev\\a.ts');
  });
});
