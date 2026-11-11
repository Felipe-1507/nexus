import { describe, expect, it } from 'vitest';
import type { GalaxyGraph } from '@shared/knowledge';
import { layoutGalaxy } from './layout';
import { describeStop, planTour } from './explore';

function graph(notes: Array<[string, number]>): GalaxyGraph {
  return {
    notes: notes.map(([path, degree]) => ({
      path,
      title: path.replace(/^.*\//, '').replace(/\.md$/, ''),
      system: path.includes('/') ? path.slice(0, path.indexOf('/')) : '',
      tags: [],
      mtimeMs: 0,
      chars: 0,
      degree,
    })),
    links: [],
  };
}

describe('tour guiado', () => {
  const g = graph([
    ['A/a1.md', 1],
    ['A/a2.md', 5],
    ['A/a3.md', 0],
    ['B/b1.md', 0],
    ['B/b2.md', 0],
    ['C/c1.md', 2],
  ]);
  const layout = layoutGalaxy(g, 0);
  const sys = (name: string) => layout.systems.findIndex((s) => s.name === name);

  it('visão geral, depois os sistemas do maior para o menor, cada um com a nota mais conectada (se tiver ligações)', () => {
    expect(planTour(g, layout)).toEqual([
      { kind: 'overview' },
      { kind: 'system', system: sys('A') },
      { kind: 'note', note: 1 },
      { kind: 'system', system: sys('B') },
      { kind: 'system', system: sys('C') },
      { kind: 'note', note: 5 },
    ]);
  });

  it('respeita o limite de sistemas e descreve cada parada', () => {
    const stops = planTour(g, layout, 1);
    expect(stops).toHaveLength(3);
    expect(describeStop(stops[0]!, g, layout)).toEqual({ title: 'A galáxia inteira', detail: '6 notas em 3 sistemas' });
    expect(describeStop(stops[1]!, g, layout)).toEqual({ title: 'A', detail: 'Sistema com 3 notas' });
    expect(describeStop(stops[2]!, g, layout).title).toBe('a2');
  });

  it('galáxia vazia: só a visão geral', () => {
    const empty = graph([]);
    expect(planTour(empty, layoutGalaxy(empty, 0))).toEqual([{ kind: 'overview' }]);
  });
});
