import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildIndex, NoteIndex, type NoteMeta } from './note-index';
import { Vault } from './vault';

function note(path: string, links: string[] = [], extra: Partial<NoteMeta> = {}): NoteMeta {
  const title = path.replace(/^.*\//, '').replace(/\.md$/, '');
  return {
    path,
    title,
    summary: '',
    tags: [],
    links,
    aliases: [],
    mtimeMs: 1,
    chars: 0,
    codeBlocks: 0,
    images: 0,
    attachments: [],
    embeds: [],
    ...extra,
  };
}

describe('grafo da galáxia', () => {
  it('liga notas por links resolvidos, uma rota por par, sem links para si mesma nem para notas que não existem', () => {
    const index = new NoteIndex([
      note('Trabalho/Conciliação.md', ['Bancos', 'Bancos', 'Inexistente', 'Conciliação']),
      note('Trabalho/Bancos.md', ['Conciliação']),
      note('Ideias.md', ['trabalho/conciliação']),
      note('Pessoal/Leituras.md'),
    ]);
    const { notes, links, directions } = index.graph();
    // Conciliação e Bancos se citam (3); Ideias cita Conciliação, o segundo do par cita o primeiro (2).
    expect(directions).toEqual([3, 2]);
    expect(notes.map((n) => [n.path, n.system, n.degree])).toEqual([
      ['Trabalho/Conciliação.md', 'Trabalho', 2],
      ['Trabalho/Bancos.md', 'Trabalho', 1],
      ['Ideias.md', '', 1],
      ['Pessoal/Leituras.md', 'Pessoal', 0],
    ]);
    expect(links).toEqual([
      [0, 1],
      [0, 2],
    ]);
  });

  it('o sistema é a pasta de primeiro nível, mesmo em subpastas', () => {
    const { notes } = new NoteIndex([note('Projetos/Nexus/Galáxia.md')]).graph();
    expect(notes[0]!.system).toBe('Projetos');
  });

  it('resolve por alias e prefere a nota da mesma pasta', () => {
    const index = new NoteIndex([
      note('A/Resumo.md'),
      note('B/Resumo.md'),
      note('B/Origem.md', ['Resumo', 'Apelido']),
      note('C/Alvo.md', [], { aliases: ['Apelido'] }),
    ]);
    expect(index.resolve('Resumo', 'B/Origem.md')).toBe('B/Resumo.md');
    expect(index.resolve('apelido')).toBe('C/Alvo.md');
    expect(index.graph().links).toEqual([
      [1, 2],
      [2, 3],
    ]);
  });

  it('monta o grafo de 2.000 notas rapidamente', () => {
    const notes = Array.from({ length: 2_000 }, (_, i) =>
      note(`Pasta${i % 20}/Nota ${i}.md`, [`Nota ${(i + 1) % 2_000}`, `Nota ${(i * 7) % 2_000}`, 'Pasta3/Nota 3']),
    );
    const started = performance.now();
    const graph = new NoteIndex(notes).graph();
    expect(performance.now() - started).toBeLessThan(500);
    expect(graph.notes).toHaveLength(2_000);
    expect(graph.links.length).toBeGreaterThan(3_000);
  });
});

describe('índice incremental', () => {
  it('relê só as notas cujo mtime mudou', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-index-'));
    try {
      fs.writeFileSync(path.join(root, 'A.md'), '# A\n[[B]]\n');
      fs.writeFileSync(path.join(root, 'B.md'), '# B\n');
      const vault = new Vault(root);
      const first = await buildIndex(vault);

      fs.writeFileSync(path.join(root, 'B.md'), '# B nova\n[[A]]\n');
      const later = new Date(Date.now() + 5_000);
      fs.utimesSync(path.join(root, 'B.md'), later, later);
      fs.writeFileSync(path.join(root, 'C.md'), '# C\n');
      const second = await buildIndex(vault, first);

      expect(second.get('A.md')).toBe(first.get('A.md'));
      expect(second.get('B.md')).toMatchObject({ title: 'B nova', links: ['A'] });
      expect(second.get('C.md')?.title).toBe('C');
      expect(second.get('B.md')?.chars).toBe('# B nova\n[[A]]\n'.length);
      expect(second.graph().links).toEqual([[0, 1]]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
