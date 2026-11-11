import { describe, expect, it } from 'vitest';
import type { GalaxyGraph } from '@shared/knowledge';
import { seeded } from './effects';
import { layoutGalaxy } from './layout';
import { galaxyRadius, planShipTarget } from './ship-effects';

const g: GalaxyGraph = {
  notes: ['A/1.md', 'A/2.md', 'A/3.md', 'B/1.md', 'Solta.md'].map((path) => ({
    path,
    title: path,
    system: path.includes('/') ? path.slice(0, path.indexOf('/')) : '',
    tags: [],
    mtimeMs: 0,
    chars: 0,
    degree: 0,
  })),
  links: [],
};
const layout = layoutGalaxy(g, 0);

describe('naves ambientais', () => {
  it('visitam sistemas chegando pela borda e, quando vagam, não saem da galáxia', () => {
    const rand = seeded(5);
    const radius = galaxyRadius(layout);
    let visits = 0;
    for (let i = 0; i < 300; i++) {
      const t = planShipTarget(layout, rand, radius);
      if (t.kind === 'visit') {
        visits++;
        const s = layout.systems[t.system]!;
        const d = Math.hypot(t.point.x - s.x, t.point.z - s.z);
        expect(d).toBeGreaterThanOrEqual(s.extent * 0.7 - 1e-6);
        expect(d).toBeLessThanOrEqual(s.extent + 1e-6);
      } else {
        expect(Math.hypot(t.point.x, t.point.z)).toBeLessThanOrEqual(radius + 1e-6);
      }
    }
    // A maioria das viagens é visita (65%), mas não todas.
    expect(visits).toBeGreaterThan(150);
    expect(visits).toBeLessThan(270);
  });

  it('o mesmo sorteio dá o mesmo caminho', () => {
    const a = planShipTarget(layout, seeded(9));
    const b = planShipTarget(layout, seeded(9));
    expect(a.point.toArray()).toEqual(b.point.toArray());
  });
});
