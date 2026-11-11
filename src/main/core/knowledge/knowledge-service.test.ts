import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { KnowledgeEvent } from '@shared/knowledge';
import { createWatcher } from '../../fs/watcher';
import { migrate } from '../../persistence/migrator';
import { migrations } from '../../persistence/migrations';
import { WorkspaceService } from '../workspaces/workspace-service';
import { KnowledgeService } from './knowledge-service';

let root: string;
let db: DatabaseSync;
let workspaces: WorkspaceService;
let events: KnowledgeEvent[];
let knowledge: KnowledgeService;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-know-'));
  db = new DatabaseSync(':memory:');
  migrate(db, migrations);
  workspaces = new WorkspaceService({ db, dataRoot: root });
  events = [];
  knowledge = new KnowledgeService({ workspaces, emit: (e) => events.push(e) });
});
afterEach(() => {
  knowledge.close();
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const base = { color: 'violet', icon: 'layers' } as const;

function note(wsId: string, rel: string, content: string) {
  const file = path.join(knowledge.dir(wsId), rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  // Sem watcher neste teste: invalida o índice como o watcher faria.
  knowledge.invalidate(wsId);
}

describe('KnowledgeService', () => {
  it('resolve links como o Obsidian e calcula backlinks', async () => {
    const ws = workspaces.create({ name: 'Trabalho', ...base });
    note(ws.id, 'Processos/Fechamento.md', '# Fechamento\n\nUsa a [[conciliação bancária]] e o [[HYLIAN]].');
    note(ws.id, 'Processos/Conciliação Bancária.md', '# Conciliação\n\nDiária.');
    note(ws.id, 'Sistemas/HYLIAN.md', '---\naliases: [Hylian ERP]\n---\n# HYLIAN\n\nERP. Ver [[Fechamento]].');
    note(ws.id, 'Ideias.md', 'Falar do [[Hylian ERP]] e de [[Nota Futura]].');

    expect(await knowledge.links(ws.id, 'Processos/Fechamento.md')).toEqual({
      outgoing: [
        { target: 'conciliação bancária', path: 'Processos/Conciliação Bancária.md' },
        { target: 'HYLIAN', path: 'Sistemas/HYLIAN.md' },
      ],
      backlinks: [{ path: 'Sistemas/HYLIAN.md', title: 'HYLIAN' }],
    });
    expect((await knowledge.links(ws.id, 'Sistemas/HYLIAN.md')).backlinks.map((b) => b.path).sort()).toEqual([
      'Ideias.md',
      'Processos/Fechamento.md',
    ]);
    expect((await knowledge.links(ws.id, 'Ideias.md')).outgoing[1]).toEqual({ target: 'Nota Futura', path: null });
  });

  it('prefere a nota da mesma pasta quando o nome se repete', async () => {
    const ws = workspaces.create({ name: 'A', ...base });
    note(ws.id, 'X/Resumo.md', 'x');
    note(ws.id, 'Y/Resumo.md', 'y');
    note(ws.id, 'Y/Index.md', '[[Resumo]]');
    expect(await knowledge.resolveLink(ws.id, 'Resumo', 'Y/Index.md')).toBe('Y/Resumo.md');
    expect(await knowledge.resolveLink(ws.id, 'X/Resumo')).toBe('X/Resumo.md');
  });

  it('índice para o prompt com caminho, título, resumo e tags, respeitando o limite', async () => {
    const ws = workspaces.create({ name: 'A', ...base });
    note(ws.id, 'Processos/Fechamento.md', '# Fechamento Mensal\n\nRotina do dia 1 ao 5. #trabalho');
    const prompt = await knowledge.promptSection(ws.id);
    expect(prompt.dir).toBe(path.join(ws.rootPath, 'Conhecimentos'));
    expect(prompt.lines).toEqual([
      '- Processos/Fechamento.md — Fechamento Mensal: Rotina do dia 1 ao 5. #trabalho [#trabalho]',
    ]);
    for (let i = 0; i < 200; i++) note(ws.id, `n${i}.md`, `# Nota ${i}\n\n${'texto '.repeat(20)}`);
    const big = await knowledge.promptSection(ws.id);
    expect(big.lines.join('\n').length).toBeLessThanOrEqual(6200);
    expect(big.omitted).toBeGreaterThan(0);
  });

  it('quando o índice não cabe, ficam as notas mais ligadas, não só as mexidas por último', async () => {
    const ws = workspaces.create({ name: 'A', ...base });
    note(ws.id, 'Mapa.md', '# Mapa\n\nVisão geral. [[n0]] [[n1]] [[n2]] [[n3]]');
    for (let i = 0; i < 4; i++) note(ws.id, `n${i}.md`, `# Nota ${i}\n\n[[Mapa]]`);
    for (let i = 0; i < 200; i++) note(ws.id, `solta${i}.md`, `# Solta ${i}\n\n${'texto '.repeat(20)}`);
    const prompt = await knowledge.promptSection(ws.id);
    expect(prompt.omitted).toBeGreaterThan(0);
    expect(prompt.lines[0]).toContain('Mapa.md');
    expect(prompt.lines.join('\n')).toContain('n0.md');
  }, 20_000);

  it('pedidos simultâneos dividem a mesma montagem, e uma alteração no meio dela não deixa o índice velho', async () => {
    const ws = workspaces.create({ name: 'A', ...base });
    knowledge.create(ws.id, '', 'Primeira');
    const [a, b] = await Promise.all([knowledge.index(ws.id), knowledge.index(ws.id)]);
    expect(a).toBe(b);

    knowledge.invalidate(ws.id);
    const during = knowledge.index(ws.id);
    knowledge.create(ws.id, '', 'Segunda');
    expect((await during).get('Segunda.md')).toBeUndefined();
    expect((await knowledge.index(ws.id)).get('Segunda.md')?.title).toBe('Segunda');
  });

  it('isolamento: cada Workspace tem o próprio vault', () => {
    const a = workspaces.create({ name: 'A', ...base });
    const b = workspaces.create({ name: 'B', ...base });
    knowledge.create(a.id, '', 'Segredo de A');
    expect(knowledge.tree(b.id).children).toEqual([]);
    expect(() =>
      knowledge.read(b.id, '../../' + path.basename(a.rootPath) + '/Conhecimentos/Segredo de A.md'),
    ).toThrow();
  });

  it('avisa a tela quando um arquivo muda por fora (watcher)', async () => {
    const ws = workspaces.create({ name: 'A', ...base });
    const watched = new KnowledgeService({ workspaces, emit: (e) => events.push(e), watch: createWatcher() });
    try {
      watched.tree(ws.id);
      await new Promise((r) => setTimeout(r, 300));
      fs.writeFileSync(path.join(watched.dir(ws.id), 'Externa.md'), '# Externa\n\n[[Outra]]');
      await expect.poll(() => events.some((e) => e.paths.includes('Externa.md')), { timeout: 5000 }).toBe(true);
      expect((await watched.index(ws.id)).get('Externa.md')?.title).toBe('Externa');
    } finally {
      watched.close();
    }
  });
});
