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
    // 80 mil comparações com expect: passa de 5 s com a máquina ocupada (testes de ponta a ponta rodando ao lado).
  }, 30_000);

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

describe('sol no centro e braços de espiral', () => {
  const many = (count: number, withCore: boolean) => {
    const paths: string[] = withCore ? ['Solta 1.md', 'Solta 2.md', 'Solta 3.md'] : [];
    for (let s = 0; s < count; s++) for (let n = 0; n <= (s * 37) % 40; n++) paths.push(`Pasta ${s}/Nota ${n}.md`);
    return layoutGalaxy(graph(paths), NOW);
  };

  it('o sol fica na origem; nenhum sistema entra nele e o núcleo orbita em volta dele', () => {
    for (const withCore of [true, false]) {
      const { sun, systems, notes } = many(30, withCore);
      expect(sun.radius).toBeGreaterThan(0);
      for (const s of systems) {
        if (s.core) {
          expect(s).toMatchObject({ x: 0, y: 0, z: 0, name: '' });
          // Os planetas do núcleo ficam fora do sol, com a folga do próprio tamanho.
          notes.forEach((n, i) => {
            if (n.system !== 0) return;
            expect(Math.hypot(n.x, n.z) - n.size).toBeGreaterThan(sun.radius);
            expect(i).toBeGreaterThanOrEqual(0);
          });
        } else expect(Math.hypot(s.x, s.z) - s.extent).toBeGreaterThan(sun.radius);
      }
      expect(systems.filter((s) => s.core)).toHaveLength(withCore ? 1 : 0);
    }
  });

  it('o conjunto é redondo: o centro de massa fica perto do sol e nenhum lado é muito maior que o oposto', () => {
    const { systems } = many(60, true);
    const reach = Math.max(...systems.map((s) => Math.hypot(s.x, s.z) + s.extent));
    const cx = systems.reduce((a, s) => a + s.x, 0) / systems.length;
    const cz = systems.reduce((a, s) => a + s.z, 0) / systems.length;
    expect(Math.hypot(cx, cz)).toBeLessThan(reach * 0.25);
    // Alcance em oito direções: o maior não passa de 2,2 vezes o menor (a espiral não fica torta para um lado).
    const sectors = new Array<number>(8).fill(0);
    for (const s of systems) {
      const k = Math.floor(((Math.atan2(s.z, s.x) + Math.PI) / (Math.PI * 2)) * 8) % 8;
      sectors[k] = Math.max(sectors[k]!, Math.hypot(s.x, s.z) + s.extent);
    }
    expect(Math.max(...sectors) / Math.min(...sectors.filter((v) => v > 0))).toBeLessThan(2.2);
    expect(sectors.every((v) => v > 0)).toBe(true);
  });

  it('os sistemas maiores ficam mais perto do sol que os menores (na média)', () => {
    const { systems } = many(40, false);
    const byDistance = [...systems].sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
    const half = Math.floor(byDistance.length / 2);
    const mean = (list: typeof systems) => list.reduce((a, s) => a + s.count, 0) / list.length;
    expect(mean(byDistance.slice(0, half))).toBeGreaterThan(mean(byDistance.slice(half)));
  });

  it('é determinístico e cresce em braços: sistemas do mesmo braço ficam em fila para fora', () => {
    const a = many(30, true);
    expect(many(30, true)).toEqual(a);
    const angle = (s: { x: number; z: number }) => Math.atan2(s.z, s.x);
    const outer = a.systems.filter((s) => !s.core).slice(-3);
    // Os últimos sistemas, um por braço, ficam em direções bem diferentes (não todos para o mesmo lado).
    const spread = Math.max(...outer.map(angle)) - Math.min(...outer.map(angle));
    expect(spread).toBeGreaterThan(1);
  });
});
