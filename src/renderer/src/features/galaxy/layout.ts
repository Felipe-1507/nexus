import type { GalaxyGraph } from '@shared/knowledge';
import { DEFAULT_PALETTE } from '@shared/palette';
import { hash01, planetSize } from '@shared/planets';

/**
 * Disposição da galáxia, calculada sem simulação física: cada posição sai de contas fixas sobre o caminho da nota.
 * Assim a galáxia abre na hora mesmo com milhares de notas e os planetas não mudam de lugar entre uma abertura e
 * outra.
 *
 * - Sistema solar = pasta de primeiro nível. As notas soltas formam o núcleo, no centro.
 * - Os sistemas seguem uma espiral (ângulo de ouro): cada um fica na menor distância ao centro em que não encosta em
 *   nenhum dos anteriores, então dois sistemas nunca se sobrepõem.
 * - Dentro do sistema, as notas mais conectadas ficam perto da estrela. O ângulo vem do caminho e não muda.
 */

export interface PlacedSystem {
  name: string;
  x: number;
  y: number;
  z: number;
  /** Raio ocupado pelos planetas do sistema. */
  extent: number;
  count: number;
  color: string;
}

export interface PlacedNote {
  x: number;
  y: number;
  z: number;
  size: number;
  system: number;
  /** 0 a 1: brilho da nota recente (1 = mexida nos últimos 7 dias). */
  glow: number;
}

export interface GalaxyLayout {
  systems: PlacedSystem[];
  notes: PlacedNote[];
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const SYSTEM_MARGIN = 6;
const PUSH_STEP = 2;
const DAY = 86_400_000;

export function systemExtent(count: number): number {
  return 6 + 3.2 * Math.sqrt(count);
}

/** Brilho pela idade: pleno até 7 dias, apagando até os 30. */
export function recencyGlow(mtimeMs: number, now: number): number {
  const age = (now - mtimeMs) / DAY;
  if (age <= 7) return 1;
  return Math.max(0, 1 - (age - 7) / 23);
}

/** `colors`: a primeira é a do núcleo; as outras se revezam entre os sistemas. */
export function layoutGalaxy(
  graph: GalaxyGraph,
  now = Date.now(),
  colors: string[] = DEFAULT_PALETTE.galaxy,
): GalaxyLayout {
  const [core = '#ffffff', ...cycle] = colors;
  if (cycle.length === 0) cycle.push(core);
  const groups = new Map<string, number[]>();
  graph.notes.forEach((n, i) => {
    const list = groups.get(n.system);
    if (list) list.push(i);
    else groups.set(n.system, [i]);
  });
  // Núcleo primeiro; depois os sistemas maiores, e o nome desempata (ordem estável).
  const names = [...groups.keys()].sort(
    (a, b) =>
      Number(b === '') - Number(a === '') || groups.get(b)!.length - groups.get(a)!.length || a.localeCompare(b),
  );

  const systems: PlacedSystem[] = [];
  const notes = new Array<PlacedNote>(graph.notes.length);
  let distance = 0;
  let colorIndex = 0;

  names.forEach((name, k) => {
    const members = groups.get(name)!;
    const extent = systemExtent(members.length);
    const isCore = name === '' && k === 0;
    const angle = k * GOLDEN_ANGLE;
    // Começa na distância do sistema anterior e se afasta do centro até não encostar em nenhum já colocado.
    const clear = (d: number) =>
      systems.every(
        (o) => Math.hypot(Math.cos(angle) * d - o.x, Math.sin(angle) * d - o.z) >= o.extent + extent + SYSTEM_MARGIN,
      );
    if (k > 0) while (!clear(distance)) distance += PUSH_STEP;
    const system: PlacedSystem = {
      name,
      x: Math.cos(angle) * distance,
      y: isCore ? 0 : (hash01(`y:${name}`) - 0.5) * 8,
      z: Math.sin(angle) * distance,
      extent,
      count: members.length,
      color: isCore ? core : cycle[colorIndex++ % cycle.length]!,
    };
    systems.push(system);

    const ranked = [...members].sort(
      (a, b) =>
        graph.notes[b]!.degree - graph.notes[a]!.degree || graph.notes[a]!.path.localeCompare(graph.notes[b]!.path),
    );
    const inner = 2.5;
    ranked.forEach((i, rank) => {
      const note = graph.notes[i]!;
      const r = inner + (extent - inner) * Math.sqrt((rank + 0.5) / members.length);
      const theta = hash01(note.path) * Math.PI * 2;
      notes[i] = {
        x: system.x + Math.cos(theta) * r,
        y: system.y + (hash01(`y:${note.path}`) - 0.5) * Math.min(3, extent * 0.2),
        z: system.z + Math.sin(theta) * r,
        size: planetSize(note.degree, note.chars),
        system: systems.length - 1,
        glow: recencyGlow(note.mtimeMs, now),
      };
    });
  });

  return { systems, notes };
}

const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** Busca por título ou caminho, sem diferenciar acentos nem maiúsculas. Títulos que começam com o termo vêm antes. */
export function searchNotes(graph: GalaxyGraph, query: string, limit = 8): number[] {
  const q = normalize(query.trim());
  if (!q) return [];
  const scored: Array<{ i: number; score: number }> = [];
  graph.notes.forEach((n, i) => {
    const title = normalize(n.title);
    const score = title.startsWith(q) ? 0 : title.includes(q) ? 1 : normalize(n.path).includes(q) ? 2 : -1;
    if (score >= 0) scored.push({ i, score });
  });
  scored.sort((a, b) => a.score - b.score || graph.notes[a.i]!.title.localeCompare(graph.notes[b.i]!.title, 'pt-BR'));
  return scored.slice(0, limit).map((s) => s.i);
}
