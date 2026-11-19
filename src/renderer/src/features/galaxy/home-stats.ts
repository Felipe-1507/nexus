import type { GalaxyGraph } from '@shared/knowledge';

/**
 * Métricas do painel Home da galáxia (GE1). Tudo sai do grafo que a galáxia já carregou (datas, tamanhos e links do
 * índice de notas): nada de leitura extra de disco, de chamada ao Claude ou de resumo gerado.
 */

export const HOME_DAYS = 30;
export const HOME_WEEK_DAYS = 7;
const DAY_MS = 86_400_000;
const LIST_SIZE = 6;

export interface HomeSystem {
  /** Nome da pasta ('' = notas soltas na raiz, o núcleo). */
  name: string;
  count: number;
  /** Índices das notas no grafo (para a câmera enquadrar o sistema). */
  indices: number[];
}

export interface HomeNote {
  index: number;
  title: string;
  system: string;
  mtimeMs: number;
  degree: number;
}

export interface HomeStats {
  notes: number;
  links: number;
  /** Pastas de primeiro nível com notas (o núcleo não conta). */
  systems: number;
  /** Alteradas nos últimos 7 dias. */
  updatedWeek: number;
  /** Notas sem nenhuma ligação. */
  orphans: number;
  /** Arquivos incorporados (imagens e anexos) em todas as notas. */
  attachments: number;
  /** Alterações por dia nos últimos 30 dias: o último item é hoje. */
  perDay: number[];
  bySystem: HomeSystem[];
  topConnected: HomeNote[];
  recent: HomeNote[];
}

const startOfDay = (ms: number) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** Quantos dias de calendário (no fuso do computador) separam `ms` de `now`: 0 = hoje. */
function daysAgo(ms: number, now: number): number {
  return Math.round((startOfDay(now) - startOfDay(ms)) / DAY_MS);
}

export function computeHomeStats(graph: GalaxyGraph, now: number): HomeStats {
  const perDay = new Array<number>(HOME_DAYS).fill(0);
  const systems = new Map<string, HomeSystem>();
  let updatedWeek = 0;
  let orphans = 0;
  let attachments = 0;
  const all: HomeNote[] = [];

  graph.notes.forEach((n, index) => {
    const ago = daysAgo(n.mtimeMs, now);
    // Data no futuro (relógio diferente entre máquinas) conta como hoje.
    const bucket = Math.max(0, ago);
    if (bucket < HOME_DAYS) perDay[HOME_DAYS - 1 - bucket]!++;
    if (bucket < HOME_WEEK_DAYS) updatedWeek++;
    if (n.degree === 0) orphans++;
    attachments += n.attachments ?? 0;
    const system = systems.get(n.system) ?? { name: n.system, count: 0, indices: [] };
    system.count++;
    system.indices.push(index);
    systems.set(n.system, system);
    all.push({ index, title: n.title, system: n.system, mtimeMs: n.mtimeMs, degree: n.degree });
  });

  const byTitle = (a: HomeNote, b: HomeNote) => a.title.localeCompare(b.title, 'pt-BR');
  const bySystem = [...systems.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pt-BR'));
  return {
    notes: graph.notes.length,
    links: graph.links.length,
    systems: bySystem.filter((s) => s.name !== '').length,
    updatedWeek,
    orphans,
    attachments,
    perDay,
    bySystem,
    topConnected: all
      .filter((n) => n.degree > 0)
      .sort((a, b) => b.degree - a.degree || byTitle(a, b))
      .slice(0, LIST_SIZE),
    recent: [...all].sort((a, b) => b.mtimeMs - a.mtimeMs || byTitle(a, b)).slice(0, LIST_SIZE),
  };
}
