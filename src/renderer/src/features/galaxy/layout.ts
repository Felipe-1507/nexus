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
 * - Dentro do sistema, os planetas giram em órbitas em volta da estrela: as notas mais conectadas nas órbitas de
 *   dentro. Cada órbita tem folga para o maior planeta, então nenhum encosta em outro.
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

/** Órbita circular de um sistema (o plano da galáxia), para desenhar o traço. */
export interface PlacedOrbit {
  system: number;
  radius: number;
}

export interface GalaxyLayout {
  systems: PlacedSystem[];
  orbits: PlacedOrbit[];
  notes: PlacedNote[];
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const SYSTEM_MARGIN = 6;
const PUSH_STEP = 2;
const DAY = 86_400_000;

/** Raio livre em volta de um planeta (anel e brilho incluídos): dois planetas nunca ficam mais perto que isso. */
export function footprint(size: number): number {
  return size * 2.4;
}

const ORBIT_GAP = 1.2;
const FIRST_ORBIT = 5;

interface Orbit {
  radius: number;
  /** Índices na lista de planetas do sistema (do mais para o menos conectado). */
  slots: number[];
  /** Maior raio livre entre os planetas da órbita. */
  reach: number;
}

/**
 * Distribui os planetas em órbitas concêntricas em volta da estrela, da mais próxima (mais conectados) para a mais
 * distante. Em cada órbita os planetas ficam a distâncias iguais e a corda entre vizinhos comporta os dois; entre uma
 * órbita e a seguinte sobra uma folga. Assim nada encosta.
 */
function planOrbits(sizes: number[]): { orbits: Orbit[]; extent: number } {
  const orbits: Orbit[] = [];
  let next = 0;
  let radius = FIRST_ORBIT;
  while (next < sizes.length) {
    const previous = orbits.at(-1);
    for (;;) {
      const slots: number[] = [];
      let reach = 0;
      for (let i = next; i < sizes.length; i++) {
        const w = Math.max(reach, footprint(sizes[i]!));
        const m = slots.length + 1;
        if (m > 1 && 2 * radius * Math.sin(Math.PI / m) < 2 * w + ORBIT_GAP) break;
        slots.push(i);
        reach = w;
      }
      const minRadius = previous
        ? previous.radius + previous.reach + reach + ORBIT_GAP
        : Math.max(FIRST_ORBIT, reach + 2.5);
      if (radius < minRadius) {
        radius = minRadius;
        continue;
      }
      orbits.push({ radius, slots, reach });
      next += slots.length;
      radius += ORBIT_GAP;
      break;
    }
  }
  const last = orbits.at(-1);
  return { orbits, extent: last ? last.radius + last.reach + 1 : FIRST_ORBIT };
}

/** Raio ocupado por um sistema com esses planetas. */
export function systemExtent(sizes: number[]): number {
  return planOrbits(sizes).extent;
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
  const orbits: PlacedOrbit[] = [];
  const notes = new Array<PlacedNote>(graph.notes.length);
  let distance = 0;
  let colorIndex = 0;

  names.forEach((name, k) => {
    const members = groups.get(name)!;
    const ranked = [...members].sort(
      (a, b) =>
        graph.notes[b]!.degree - graph.notes[a]!.degree || graph.notes[a]!.path.localeCompare(graph.notes[b]!.path),
    );
    const sizes = ranked.map((i) => planetSize(graph.notes[i]!.degree, graph.notes[i]!.chars));
    const plan = planOrbits(sizes);
    const extent = plan.extent;
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

    plan.orbits.forEach((orbit) => {
      orbits.push({ system: systems.length - 1, radius: orbit.radius });
      const offset = hash01(`o:${name}:${orbit.radius.toFixed(2)}`) * Math.PI * 2;
      orbit.slots.forEach((slot, n) => {
        const i = ranked[slot]!;
        const note = graph.notes[i]!;
        const theta = offset + (n / orbit.slots.length) * Math.PI * 2;
        notes[i] = {
          x: system.x + Math.cos(theta) * orbit.radius,
          y: system.y,
          z: system.z + Math.sin(theta) * orbit.radius,
          size: sizes[slot]!,
          system: systems.length - 1,
          glow: recencyGlow(note.mtimeMs, now),
        };
      });
    });
  });

  return { systems, orbits, notes };
}

/**
 * Caminho da nota relativo ao vault (com `/`), se o arquivo for uma nota dentro dele; senão `null`. Compara sem
 * diferenciar maiúsculas e barras, como o Windows.
 */
export function noteInVault(vault: string, file: string): string | null {
  const clean = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const root = clean(vault);
  const target = clean(file);
  if (!/\.md$/i.test(target) || target.length <= root.length + 1) return null;
  if (target.slice(0, root.length).toLowerCase() !== root.toLowerCase() || target[root.length] !== '/') return null;
  const rel = target.slice(root.length + 1);
  return rel.split('/').some((part) => part === '..' || part === '') ? null : rel;
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
