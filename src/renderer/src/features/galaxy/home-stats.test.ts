import { describe, expect, it } from 'vitest';
import type { GalaxyGraph } from '@shared/knowledge';
import { computeHomeStats, HOME_DAYS } from './home-stats';

const NOW = new Date(2026, 10, 19, 15, 0, 0).getTime();
const daysBefore = (n: number, hour = 9) => new Date(2026, 10, 19 - n, hour, 0, 0).getTime();

function note(title: string, system: string, mtimeMs: number, degree = 0, attachments = 0) {
  return { path: `${system}/${title}.md`, title, system, tags: [], mtimeMs, chars: 100, degree, attachments };
}

function graph(notes: ReturnType<typeof note>[], links: Array<[number, number]> = []): GalaxyGraph {
  return { notes, links };
}

describe('computeHomeStats', () => {
  it('grafo vazio: tudo zerado, sem quebrar', () => {
    const s = computeHomeStats(graph([]), NOW);
    expect(s).toMatchObject({ notes: 0, links: 0, systems: 0, updatedWeek: 0, orphans: 0, attachments: 0 });
    expect(s.perDay).toHaveLength(HOME_DAYS);
    expect(s.perDay.every((n) => n === 0)).toBe(true);
    expect(s.bySystem).toEqual([]);
    expect(s.topConnected).toEqual([]);
    expect(s.recent).toEqual([]);
  });

  it('conta totais, sistemas (sem o núcleo), órfãs e anexos', () => {
    const s = computeHomeStats(
      graph(
        [
          note('A', 'NOME', daysBefore(0), 2, 3),
          note('B', 'NOME', daysBefore(1), 1, 0),
          note('C', 'Site', daysBefore(2), 1),
          note('Solta', '', daysBefore(3)),
        ],
        [
          [0, 1],
          [0, 2],
        ],
      ),
      NOW,
    );
    expect(s).toMatchObject({ notes: 4, links: 2, systems: 2, orphans: 1, attachments: 3 });
    expect(s.bySystem.map((x) => [x.name, x.count])).toEqual([
      ['NOME', 2],
      ['', 1],
      ['Site', 1],
    ]);
    expect(s.bySystem[0]!.indices).toEqual([0, 1]);
  });

  it('semana e histograma usam o dia do calendário, não 24 horas', () => {
    // Ontem às 23:59 está a menos de 24 h de hoje às 15:00? Não: é de ontem mesmo assim, e vice-versa.
    const lateYesterday = new Date(2026, 10, 18, 23, 59).getTime();
    const s = computeHomeStats(
      graph([
        note('hoje', 'X', daysBefore(0, 0)),
        note('ontem-tarde', 'X', lateYesterday),
        note('seis-dias', 'X', daysBefore(6)),
        note('sete-dias', 'X', daysBefore(7)),
        note('29-dias', 'X', daysBefore(29)),
        note('30-dias', 'X', daysBefore(30)),
      ]),
      NOW,
    );
    expect(s.updatedWeek).toBe(3); // hoje, ontem, 6 dias atrás
    expect(s.perDay[HOME_DAYS - 1]).toBe(1);
    expect(s.perDay[HOME_DAYS - 2]).toBe(1);
    expect(s.perDay[HOME_DAYS - 7]).toBe(1);
    expect(s.perDay[HOME_DAYS - 8]).toBe(1);
    expect(s.perDay[0]).toBe(1);
    expect(s.perDay.reduce((a, b) => a + b, 0)).toBe(5); // a de 30 dias fica fora
  });

  it('data no futuro conta como hoje', () => {
    const s = computeHomeStats(graph([note('futuro', 'X', NOW + 3 * 86_400_000)]), NOW);
    expect(s.perDay[HOME_DAYS - 1]).toBe(1);
    expect(s.updatedWeek).toBe(1);
  });

  it('rankings: mais conectadas (sem as órfãs) e mais recentes, com desempate estável por título', () => {
    const notes = [
      note('Zeta', 'X', daysBefore(5), 3),
      note('Alfa', 'X', daysBefore(5), 3),
      note('Meio', 'X', daysBefore(1), 1),
      note('Nova', 'X', daysBefore(0), 0),
    ];
    const s = computeHomeStats(graph(notes), NOW);
    expect(s.topConnected.map((n) => n.title)).toEqual(['Alfa', 'Zeta', 'Meio']);
    expect(s.recent.map((n) => n.title)).toEqual(['Nova', 'Meio', 'Alfa', 'Zeta']);
  });

  it('as listas têm no máximo 6 itens', () => {
    const notes = Array.from({ length: 20 }, (_, i) => note(`N${i}`, 'X', daysBefore(i % 10), i + 1));
    const s = computeHomeStats(graph(notes), NOW);
    expect(s.topConnected).toHaveLength(6);
    expect(s.recent).toHaveLength(6);
  });
});
