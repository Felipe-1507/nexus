import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseQuery } from '../chat/search-text';
import { matchInText, searchFolder, searchNotes, searchProjects, newBudget } from './content-search';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-csearch-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function write(rel: string, content: string | Buffer) {
  const file = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

async function* gen(notes: Array<{ path: string; title: string; text: string }>) {
  for (const n of notes) yield n;
}

describe('matchInText', () => {
  it('acha sem diferenciar acento nem caixa e diz a linha', () => {
    const r = matchInText('primeira\nsegunda linha com Conferência Física\nterceira', parseQuery('conferencia fisica'));
    expect(r?.line).toBe(2);
    expect(r?.text).toContain('Conferência Física');
    expect(r?.ranges.length).toBeGreaterThan(0);
  });

  it('todas as palavras precisam aparecer', () => {
    expect(matchInText('só uma palavra: boleto', parseQuery('boleto remessa'))).toBeNull();
  });
});

describe('searchNotes', () => {
  const notes = [
    { path: 'NOME/Mapa.md', title: 'Mapa', text: 'O sistema usa Firebird para ler títulos.' },
    { path: 'Firebird.md', title: 'Firebird', text: 'Banco do ERP.' },
    { path: 'Outra.md', title: 'Outra', text: 'Nada a ver.' },
    { path: 'Divisao.md', title: 'Remessa', text: 'Fala do banco e do arquivo CNAB.' },
  ];

  it('procura no texto e no título, com o título primeiro', async () => {
    const r = await searchNotes(gen(notes), parseQuery('firebird'));
    expect(r.hits.map((h) => h.path)).toEqual(['Firebird.md', 'NOME/Mapa.md']);
    expect(r.hits[1]).toMatchObject({ kind: 'note', line: 1, name: 'Mapa' });
    expect(r.scanned).toBe(4);
    expect(r.truncated).toBe(false);
  });

  it('palavras repartidas entre título e texto também valem', async () => {
    const r = await searchNotes(gen(notes), parseQuery('remessa cnab'));
    expect(r.hits.map((h) => h.path)).toEqual(['Divisao.md']);
  });

  it('sem resultado', async () => {
    expect((await searchNotes(gen(notes), parseQuery('zzzz'))).hits).toEqual([]);
  });
});

describe('searchFolder / searchProjects', () => {
  const project = { id: 'p1', name: 'NOME', path: '' };

  it('acha no texto de arquivos, ignora binários, grandes e pastas de dependências', async () => {
    write('src/baixa.ts', 'export function baixaEmLote() {}\n// Conferência física\n');
    write('src/nada.ts', 'outra coisa');
    write('node_modules/lib/index.js', 'conferência física aqui também');
    write('.git/config', 'conferência física');
    write('dados.bin', Buffer.concat([Buffer.from('conferencia fisica'), Buffer.from([0, 1, 2])]));
    write('enorme.txt', 'conferência física '.repeat(100_000));
    const r = await searchProjects([{ ...project, path: root }], parseQuery('conferencia fisica'));
    expect(r.hits.map((h) => h.path)).toEqual(['src/baixa.ts']);
    expect(r.hits[0]).toMatchObject({ kind: 'file', projectId: 'p1', projectName: 'NOME', line: 2 });
    expect(r.incomplete).toBe(false);
  });

  it('o nome do arquivo também conta, e vem antes', async () => {
    write('a/leia-me.md', 'texto com baixa dentro');
    write('baixa.txt', 'sem a palavra aqui');
    const r = await searchProjects([{ ...project, path: root }], parseQuery('baixa'));
    expect(r.hits.map((h) => [h.path, h.line])).toEqual([
      ['baixa.txt', null],
      ['a/leia-me.md', 1],
    ]);
  });

  it('para no prazo e avisa que ficou incompleta', async () => {
    write('a.txt', 'nada');
    write('b.txt', 'alvo');
    const budget = newBudget(Date.now() - 60_000);
    const hits: Parameters<typeof searchFolder>[4] = [];
    await searchFolder(root, parseQuery('alvo'), { id: 'p', name: 'P' }, budget, hits);
    expect(budget.stopped).toBe(true);
    expect(hits).toEqual([]);
    const r = await searchProjects([{ ...project, path: root }], parseQuery('alvo'), Date.now() - 60_000);
    expect(r).toMatchObject({ hits: [], incomplete: true });
  });

  it('pasta inexistente não derruba a busca', async () => {
    const r = await searchProjects([{ ...project, path: path.join(root, 'nao-existe') }], parseQuery('x1'));
    expect(r).toMatchObject({ hits: [], incomplete: false, scanned: 0 });
  });
});
