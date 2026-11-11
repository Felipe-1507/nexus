import { describe, expect, it } from 'vitest';
import type { GalaxyGraph } from '@shared/knowledge';
import { layoutGalaxy } from './layout';
import { cometPairs, pickFlowRoutes } from './route-effects';

function graph(notes: Array<[string, string[]?, number?]>, links: Array<[number, number]>): GalaxyGraph {
  return {
    notes: notes.map(([path, tags = [], degree = 0]) => ({
      path,
      title: path,
      system: path.includes('/') ? path.slice(0, path.indexOf('/')) : '',
      tags,
      mtimeMs: 0,
      chars: 0,
      degree,
    })),
    links,
  };
}

describe('fluxo nas rotas', () => {
  const g = graph(
    [
      ['A/x.md', [], 1],
      ['A/y.md', [], 9],
      ['A/z.md', [], 9],
      ['B/w.md', [], 1],
    ],
    [
      [0, 1], // dentro de A
      [1, 2], // dentro de A, notas muito ligadas
      [0, 3], // entre A e B
    ],
  );
  const layout = layoutGalaxy(g, 0);

  it('prioriza as rotas entre sistemas e depois as notas mais ligadas, respeitando o limite', () => {
    expect(pickFlowRoutes(g, layout, 10)).toEqual([2, 1, 0]);
    expect(pickFlowRoutes(g, layout, 1)).toEqual([2]);
    expect(pickFlowRoutes(g, layout, 0)).toEqual([]);
  });
});

describe('cometas', () => {
  it('ligam notas de sistemas diferentes por link e por tag, sem repetir e sem pares do mesmo sistema', () => {
    const g = graph(
      [['A/x.md', ['fiscal']], ['A/y.md', ['fiscal']], ['B/z.md', ['Fiscal']], ['C/w.md']],
      [
        [0, 1],
        [0, 2],
      ],
    );
    const pairs = cometPairs(g, layoutGalaxy(g, 0));
    expect(pairs).toEqual([
      [0, 2],
      [1, 2],
    ]);
  });

  it('uma tag muito usada não passa de alguns pares', () => {
    const notes: Array<[string, string[]]> = Array.from({ length: 40 }, (_, i) => [`S${i}/n.md`, ['comum']]);
    const g = graph(notes, []);
    expect(cometPairs(g, layoutGalaxy(g, 0))).toHaveLength(4);
  });
});
