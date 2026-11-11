import { describe, expect, it } from 'vitest';
import type { GalaxyGraph } from '@shared/knowledge';
import { layoutGalaxy } from './layout';
import { cometPairs, createFlows, isImportantRoute, pickFlowRoutes } from './route-effects';

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

describe('direção e importância das rotas', () => {
  it('a luz corre de quem cita para quem é citado, e nos dois sentidos quando as notas se citam', async () => {
    const { ShaderMaterial } = await import('three');
    type Points = import('three').Points;
    const { GALAXY_PROFILES } = await import('./quality');
    const g = graph(
      [
        ['A/x.md', [], 1],
        ['B/y.md', [], 2],
        ['C/z.md', [], 1],
      ],
      [
        [0, 1],
        [1, 2],
      ],
    );
    g.directions = [3, 2];
    const flows = createFlows(g, layoutGalaxy(g, 0), GALAXY_PROFILES.original, new ShaderMaterial());
    // Rota 0 nos dois sentidos (2 pontos) + rota 1 só de z para y (1 ponto).
    expect((flows!.objects[0] as Points).geometry.getAttribute('position').count).toBe(3);
  });

  it('conexão importante: as notas se citam ou ligam duas notas centrais', () => {
    const g = graph(
      [
        ['A/x.md', [], 5],
        ['B/y.md', [], 5],
        ['C/z.md', [], 1],
      ],
      [
        [0, 1],
        [1, 2],
        [0, 2],
      ],
    );
    g.directions = [1, 3, 1];
    expect([0, 1, 2].map((r) => isImportantRoute(g, r))).toEqual([true, true, false]);
  });
});
