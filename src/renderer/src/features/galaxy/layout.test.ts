import { describe, expect, it } from 'vitest';
import type { GalaxyGraph } from '@shared/knowledge';
import { footprint, layoutGalaxy, matchNotes, parseQuery, recencyGlow, searchNotes } from './layout';
import { planetSize } from '@shared/planets';

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

function graph(paths: string[], degrees: number[] = [], chars: number[] = []): GalaxyGraph {
  return {
    notes: paths.map((path, i) => ({
      path,
      title: path.replace(/^.*\//, '').replace(/\.md$/, ''),
      system: path.includes('/') ? path.slice(0, path.indexOf('/')) : '',
      tags: [],
      mtimeMs: NOW - 60 * DAY,
      chars: chars[i] ?? 0,
      degree: degrees[i] ?? 0,
    })),
    links: [],
  };
}

const distance = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

describe('disposição da galáxia', () => {
  it('núcleo no centro e um sistema por pasta de primeiro nível', () => {
    const layout = layoutGalaxy(graph(['Ideias.md', 'Trabalho/A.md', 'Trabalho/B.md', 'Pessoal/C.md']), NOW);
    expect(layout.systems.map((s) => [s.name, s.count])).toEqual([
      ['', 1],
      ['Trabalho', 2],
      ['Pessoal', 1],
    ]);
    expect(layout.systems[0]).toMatchObject({ x: 0, y: 0, z: 0 });
    expect(layout.notes.map((n) => n.system)).toEqual([0, 1, 1, 2]);
  });

  it.each([
    ['tamanhos variados', (s: number) => (s * 37) % 120],
    ['todos iguais', () => 10],
    ['um gigante e muitos pequenos', (s: number) => (s === 0 ? 900 : 1)],
    ['crescentes', (s: number) => s * 6],
  ])('sistemas nunca se sobrepõem (%s), com ou sem núcleo', (_name, size) => {
    for (const withCore of [true, false]) {
      const paths: string[] = withCore ? ['Solta 1.md', 'Solta 2.md'] : [];
      for (let s = 0; s < 40; s++) for (let n = 0; n <= size(s); n++) paths.push(`Pasta ${s}/Nota ${n}.md`);
      const { systems } = layoutGalaxy(graph(paths), NOW);
      for (let i = 0; i < systems.length; i++)
        for (let j = i + 1; j < systems.length; j++)
          expect(distance(systems[i]!, systems[j]!)).toBeGreaterThan(systems[i]!.extent + systems[j]!.extent);
    }
  });

  it('cada planeta fica dentro do seu sistema, e os mais conectados mais perto da estrela', () => {
    const g = graph(['P/Hub.md', 'P/Folha.md', 'P/Outra.md'], [9, 0, 1]);
    const { systems, notes } = layoutGalaxy(g, NOW);
    const dist = notes.map((n) => distance(n, systems[n.system]!));
    for (const d of dist) expect(d).toBeLessThanOrEqual(systems[0]!.extent);
    expect(dist[0]).toBeLessThanOrEqual(dist[2]!);
    expect(dist[2]).toBeLessThanOrEqual(dist[1]!);
  });

  it.each([10, 60, 400])('nenhum planeta encosta em outro (sistema com %i notas)', (count) => {
    const paths = Array.from({ length: count }, (_, n) => `P/Nota ${n}.md`);
    const degrees = paths.map((_, n) => (n * 7) % 13);
    const chars = paths.map((_, n) => (n * 911) % 6000);
    const { notes, orbits } = layoutGalaxy(graph(paths, degrees, chars), NOW);
    expect(orbits.length).toBeGreaterThan(0);
    for (let i = 0; i < notes.length; i++)
      for (let j = i + 1; j < notes.length; j++)
        expect(distance(notes[i]!, notes[j]!)).toBeGreaterThan(
          footprint(notes[i]!.size) + footprint(notes[j]!.size) - 0.01,
        );
  });

  it('a posição é estável: a mesma nota fica no mesmo lugar quando o vault não muda', () => {
    const g = graph(['A/x.md', 'A/y.md', 'B/z.md']);
    expect(layoutGalaxy(g, NOW)).toEqual(layoutGalaxy(structuredClone(g), NOW));
  });

  it('tamanho cresce com as conexões, com limite; brilho para notas recentes', () => {
    expect(planetSize(0)).toBeLessThan(planetSize(4));
    expect(planetSize(10_000)).toBe(2.6);
    expect(recencyGlow(NOW - 2 * DAY, NOW)).toBe(1);
    expect(recencyGlow(NOW - 18 * DAY, NOW)).toBeCloseTo(0.52, 1);
    expect(recencyGlow(NOW - 60 * DAY, NOW)).toBe(0);
  });
});

describe('busca na galáxia', () => {
  const g = graph(['Trabalho/Conciliação bancária.md', 'Ideias/Sobre conciliação.md', 'Pessoal/Viagem.md']);

  it('ignora acentos e maiúsculas e põe primeiro os títulos que começam com o termo', () => {
    expect(searchNotes(g, 'CONCILIACAO')).toEqual([0, 1]);
    expect(searchNotes(g, 'pessoal')).toEqual([2]);
    expect(searchNotes(g, '   ')).toEqual([]);
  });
});

describe('busca visual', () => {
  const g = graph(['Fiscal/ST.md', 'Fiscal/CEST.md', 'Trabalho/Fechamento.md', 'Ideias.md']);
  g.notes[0]!.tags = ['fiscal/st', 'urgente'];
  g.notes[1]!.tags = ['Fiscal'];
  g.notes[2]!.tags = ['urgente'];

  it('separa palavras e #tags', () => {
    expect(parseQuery('  #Fiscal  cest #  ')).toEqual({ text: 'cest', tags: ['fiscal'] });
  });

  it('acende todas as notas que atendem: #tag (com subtags), palavras e as duas juntas', () => {
    expect(matchNotes(g, '#fiscal')).toEqual([0, 1]);
    expect(matchNotes(g, '#urgente')).toEqual([0, 2]);
    expect(matchNotes(g, '#urgente #fiscal')).toEqual([0]);
    expect(matchNotes(g, 'fiscal')).toEqual([0, 1]);
    expect(matchNotes(g, 'fe #urgente')).toEqual([2]);
    expect(matchNotes(g, '#')).toEqual([]);
    expect(searchNotes(g, '#fiscal')).toEqual([1, 0]);
  });
});
