import type { GalaxyGraph } from '@shared/knowledge';
import type { GalaxyLayout } from './layout';

/**
 * Exploração da galáxia (Galáxia Viva, G9): o roteiro do tour guiado. Só a câmera se mexe; nada é lido do disco nem
 * pedido ao Claude.
 */

export type TourStop = { kind: 'overview' } | { kind: 'system'; system: number } | { kind: 'note'; note: number };

/** Paradas no máximo (fora a visão geral do começo). */
export const TOUR_MAX_SYSTEMS = 8;
/** Tempo do voo entre paradas e de permanência em cada uma. */
export const TOUR_FLY_MS = 2400;
export const TOUR_DWELL_MS = 4500;

/**
 * Roteiro: a galáxia inteira, depois os sistemas do maior para o menor (até o limite) e, em cada um, a nota mais
 * conectada, quando ela tem ligações. Sempre o mesmo para o mesmo vault.
 */
export function planTour(graph: GalaxyGraph, layout: GalaxyLayout, maxSystems = TOUR_MAX_SYSTEMS): TourStop[] {
  const stops: TourStop[] = [{ kind: 'overview' }];
  if (layout.notes.length === 0) return stops;
  const order = layout.systems
    .map((s, i) => ({ i, count: s.count, name: s.name }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  for (const { i } of order.slice(0, maxSystems)) {
    stops.push({ kind: 'system', system: i });
    let hub = -1;
    layout.notes.forEach((p, n) => {
      if (p.system !== i) return;
      const d = graph.notes[n]!.degree;
      if (d > 0 && (hub < 0 || d > graph.notes[hub]!.degree)) hub = n;
    });
    if (hub >= 0) stops.push({ kind: 'note', note: hub });
  }
  return stops;
}

/** Legenda da parada (o título e uma linha de contexto), para a tela. */
export function describeStop(stop: TourStop, graph: GalaxyGraph, layout: GalaxyLayout): { title: string; detail: string } {
  if (stop.kind === 'overview') {
    const n = graph.notes.length;
    const s = layout.systems.length;
    return {
      title: 'A galáxia inteira',
      detail: `${n} ${n === 1 ? 'nota' : 'notas'} em ${s} ${s === 1 ? 'sistema' : 'sistemas'}`,
    };
  }
  if (stop.kind === 'system') {
    const s = layout.systems[stop.system]!;
    return { title: s.name || 'Núcleo', detail: `Sistema com ${s.count} ${s.count === 1 ? 'nota' : 'notas'}` };
  }
  const note = graph.notes[stop.note]!;
  return {
    title: note.title,
    detail: `Nota central de ${note.system || 'Núcleo'} · ${note.degree} ${note.degree === 1 ? 'conexão' : 'conexões'}`,
  };
}
