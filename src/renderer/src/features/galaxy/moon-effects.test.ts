import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { GalaxyGraph } from '@shared/knowledge';
import { layoutGalaxy } from './layout';
import { moonKind, moonName, moonPosition, planMoons } from './moon-effects';
import { GALAXY_PROFILES } from './quality';

function graph(moons: string[][]): GalaxyGraph {
  return {
    notes: moons.map((m, i) => ({
      path: `S/n${i}.md`,
      title: `n${i}`,
      system: 'S',
      tags: [],
      mtimeMs: 0,
      chars: 0,
      degree: 0,
      moons: m,
    })),
    links: [],
  };
}

describe('luas de anexos', () => {
  it('cor pelo tipo de arquivo', () => {
    expect(['a.PNG', 'b.pdf', 'c.xlsx', 'd.m4a', 'e.zip'].map(moonKind)).toEqual([
      'imagem',
      'documento',
      'planilha',
      'midia',
      'outro',
    ]);
    expect(moonName('Anexos/sub/contrato.pdf')).toBe('contrato.pdf');
  });

  it('respeita o limite por planeta e o total, dando a primeira lua a todos antes da segunda', () => {
    const files = Array.from({ length: 10 }, (_, k) => `f${k}.pdf`);
    const g = graph([files, files, []]);
    const layout = layoutGalaxy(g, 0);
    const leve = planMoons(g, layout, GALAXY_PROFILES.leve);
    expect(leve).toHaveLength(6); // 3 por planeta no Leve
    const original = planMoons(g, layout, GALAXY_PROFILES.original);
    expect(original).toHaveLength(12); // 6 por planeta no Original
    const tight = planMoons(g, layout, {
      ...GALAXY_PROFILES.original,
      limits: { ...GALAXY_PROFILES.original.limits, moons: 3 },
    });
    expect(tight.map((m) => m.note)).toEqual([0, 1, 0]);
  });

  it('é estável entre aberturas e fica dentro do espaço livre do planeta', () => {
    const g = graph([['a.png', 'b.pdf', 'c.csv', 'd.mp3', 'e.zip', 'f.txt']]);
    const layout = layoutGalaxy(g, 0);
    const a = planMoons(g, layout, GALAXY_PROFILES.original);
    expect(planMoons(g, layout, GALAXY_PROFILES.original)).toEqual(a);
    const p = layout.notes[0]!;
    for (const m of a) {
      const v = moonPosition(new Vector3(), m, p, 123.4);
      const d = Math.hypot(v.x - p.x, v.y - p.y, v.z - p.z);
      expect(d).toBeCloseTo(m.radius, 5);
      expect(m.radius + m.size).toBeLessThanOrEqual(p.size * 2.4 + 1e-9);
    }
  });
});
