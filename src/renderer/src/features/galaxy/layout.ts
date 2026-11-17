import type { GalaxyGraph } from '@shared/knowledge';
import { DEFAULT_PALETTE } from '@shared/palette';
import { hash01, planetSize } from '@shared/planets';

/**
 * Disposição da galáxia, calculada sem simulação física: cada posição sai de contas fixas sobre o caminho da nota.
 * Assim a galáxia abre na hora mesmo com milhares de notas e os planetas não mudam de lugar entre uma abertura e
 * outra.
 *
 * - No centro de tudo fica o sol do Workspace, sem ligação com nenhuma nota. Os sistemas giram em volta dele.
 * - Sistema solar = pasta de primeiro nível. As notas soltas formam o núcleo, que orbita o próprio sol (o sol é a
 *   estrela dele).
 * - Os sistemas giram em anéis concêntricos em volta do sol, como planetas em volta de uma estrela: os maiores nos anéis
 *   de dentro. Dentro de cada anel eles se espalham em volta do círculo com folgas e distâncias do sol um pouco
 *   diferentes (nada alinhado certinho), mas sempre sem encostar um no outro.
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
  /** Núcleo (notas soltas na raiz): fica no centro, em volta do sol, que é a estrela dele. */
  core: boolean;
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

/** O sol do Workspace, no centro (0, 0, 0). */
export interface PlacedSun {
  radius: number;
}

export interface GalaxyLayout {
  sun: PlacedSun;
  systems: PlacedSystem[];
  orbits: PlacedOrbit[];
  notes: PlacedNote[];
}

/** Raio do sol e folga em volta dele (a corona) onde nenhum sistema entra. */
export const SUN_RADIUS = 9;
const SUN_CLEAR = SUN_RADIUS + 9;
const SYSTEM_MARGIN = 6;
/** Espaço livre entre um anel de sistemas e o seguinte. */
const RING_GAP = SYSTEM_MARGIN + 4;
/** Quanto um sistema pode sair do raio do anel, em fração da folga que ele tem dentro da faixa do anel. */
const RING_JITTER = 0.35;
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
function planOrbits(sizes: number[], inner = 0): { orbits: Orbit[]; extent: number } {
  const orbits: Orbit[] = [];
  let next = 0;
  let radius = Math.max(FIRST_ORBIT, inner);
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
        : Math.max(FIRST_ORBIT, reach + 2.5, inner > 0 ? inner + reach : 0);
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

/** Raio ocupado por um sistema com esses planetas (`inner`: raio livre no meio, para o sol). */
export function systemExtent(sizes: number[], inner = 0): number {
  return planOrbits(sizes, inner).extent;
}

/** Brilho pela idade: pleno até 7 dias, apagando até os 30. */
export function recencyGlow(mtimeMs: number, now: number): number {
  const age = (now - mtimeMs) / DAY;
  if (age <= 7) return 1;
  return Math.max(0, 1 - (age - 7) / 23);
}

/**
 * Distribui sistemas em anéis concêntricos em volta da origem (o sol), a partir do raio livre `inner`. Os maiores vão
 * para os anéis de dentro. Cada anel recebe quantos sistemas couberem em volta do círculo sem encostar (a corda entre
 * vizinhos comporta os dois raios mais a margem); o espaço que sobra é repartido de forma irregular entre os vizinhos, e
 * cada sistema pode ficar um pouco mais para dentro ou para fora do raio do anel, sem sair da faixa dele. Devolve a
 * posição de cada item, na mesma ordem da entrada.
 */
export function planRings(
  items: Array<{ extent: number; key: string }>,
  inner: number,
): Array<{ x: number; z: number }> {
  const out = new Array<{ x: number; z: number }>(items.length);
  const order = items
    .map((_, i) => i)
    .sort((a, b) => items[b]!.extent - items[a]!.extent || items[a]!.key.localeCompare(items[b]!.key));
  let next = 0;
  let edge = inner;
  let ringIndex = 0;
  while (next < order.length) {
    const first = items[order[next]!]!.extent;
    const radius = edge + first;
    // Ângulo mínimo entre dois vizinhos do anel: a corda tem que comportar os dois sistemas e a margem. Usa o raio mais
    // interno que algum deles pode ter (por causa do desvio), o que só deixa a conta mais folgada.
    const span = (a: number, b: number, low: number) =>
      2 * Math.asin(Math.min(1, (items[a]!.extent + items[b]!.extent + SYSTEM_MARGIN) / (2 * low)));
    const lowest = (last: number) => radius - RING_JITTER * (first - items[last]!.extent);
    const fits = (list: number[]) => {
      if (list.length < 2) return true;
      const low = lowest(list[list.length - 1]!);
      let sum = 0;
      for (let i = 0; i < list.length; i++) sum += span(list[i]!, list[(i + 1) % list.length]!, low);
      return sum <= Math.PI * 2;
    };
    const ring = [order[next]!];
    while (next + ring.length < order.length && fits([...ring, order[next + ring.length]!])) {
      ring.push(order[next + ring.length]!);
    }
    next += ring.length;

    const start = hash01(`ring:${ringIndex}`) * Math.PI * 2;
    const low = lowest(ring[ring.length - 1]!);
    const spans = ring.map((a, i) => (ring.length < 2 ? 0 : span(a, ring[(i + 1) % ring.length]!, low)));
    const slack = Math.max(0, Math.PI * 2 - spans.reduce((a, b) => a + b, 0));
    const weights = ring.map((a) => 0.6 + 0.8 * hash01(`gap:${items[a]!.key}`));
    const weightSum = weights.reduce((a, b) => a + b, 0);
    let angle = start;
    ring.forEach((a, i) => {
      const room = first - items[a]!.extent;
      const r = radius + (hash01(`rad:${items[a]!.key}`) * 2 - 1) * RING_JITTER * room;
      out[a] = { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
      angle += spans[i]! + (slack * weights[i]!) / weightSum;
    });
    edge = radius + first + RING_GAP;
    ringIndex++;
  }
  return out;
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

  // Primeiro o tamanho de cada sistema (as órbitas dos planetas), depois a posição dele em volta do sol.
  const prepared = names.map((name, k) => {
    const members = groups.get(name)!;
    const ranked = [...members].sort(
      (x, y) =>
        graph.notes[y]!.degree - graph.notes[x]!.degree || graph.notes[x]!.path.localeCompare(graph.notes[y]!.path),
    );
    const sizes = ranked.map((i) => planetSize(graph.notes[i]!.degree, graph.notes[i]!.chars));
    const isCore = name === '' && k === 0;
    // O núcleo gira em volta do sol: a primeira órbita começa depois dele.
    const plan = planOrbits(sizes, isCore ? SUN_RADIUS + 1.5 : 0);
    return { name, members, ranked, sizes, isCore, plan };
  });
  const coreExtent = prepared.find((p) => p.isCore)?.plan.extent ?? 0;
  const others = prepared.filter((p) => !p.isCore);
  const spots = planRings(
    others.map((p) => ({ extent: p.plan.extent, key: p.name })),
    Math.max(SUN_CLEAR, coreExtent > 0 ? coreExtent + RING_GAP : 0),
  );
  const spotOf = new Map(others.map((p, i) => [p.name, spots[i]!]));

  const systems: PlacedSystem[] = [];
  const orbits: PlacedOrbit[] = [];
  const notes = new Array<PlacedNote>(graph.notes.length);
  let colorIndex = 0;

  prepared.forEach(({ name, members, ranked, sizes, isCore, plan }) => {
    const extent = plan.extent;
    const { x, z } = spotOf.get(name) ?? { x: 0, z: 0 };
    const system: PlacedSystem = {
      name,
      x,
      y: isCore ? 0 : (hash01(`y:${name}`) - 0.5) * 8,
      z,
      extent,
      count: members.length,
      color: isCore ? core : cycle[colorIndex++ % cycle.length]!,
      core: isCore,
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

  return { sun: { radius: SUN_RADIUS }, systems, orbits, notes };
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

/**
 * Termos da busca: palavras (procuradas juntas no título ou no caminho, que inclui o sistema) e `#tags` (a nota precisa
 * ter cada uma; `#fiscal` também acha `#fiscal/st`). Sem acentos e sem diferenciar maiúsculas.
 */
export function parseQuery(query: string): { text: string; tags: string[] } {
  const tags: string[] = [];
  const words: string[] = [];
  for (const token of normalize(query).split(/\s+/).filter(Boolean)) {
    if (token.startsWith('#')) {
      if (token.length > 1) tags.push(token.slice(1));
    } else words.push(token);
  }
  return { text: words.join(' '), tags };
}

/** Todas as notas que atendem a busca (a galáxia acende todas, a lista mostra só as primeiras). */
export function matchNotes(graph: GalaxyGraph, query: string): number[] {
  const { text, tags } = parseQuery(query);
  if (!text && tags.length === 0) return [];
  const out: number[] = [];
  graph.notes.forEach((n, i) => {
    if (text && !normalize(n.title).includes(text) && !normalize(n.path).includes(text)) return;
    if (tags.length > 0) {
      const own = n.tags.map(normalize);
      if (!tags.every((t) => own.some((o) => o === t || o.startsWith(`${t}/`)))) return;
    }
    out.push(i);
  });
  return out;
}

/** Busca por título, caminho ou #tag, sem diferenciar acentos nem maiúsculas. Títulos que começam com o termo vêm antes. */
export function searchNotes(graph: GalaxyGraph, query: string, limit = 8): number[] {
  const { text } = parseQuery(query);
  const scored = matchNotes(graph, query).map((i) => {
    const title = normalize(graph.notes[i]!.title);
    return { i, score: !text ? 0 : title.startsWith(text) ? 0 : title.includes(text) ? 1 : 2 };
  });
  scored.sort((a, b) => a.score - b.score || graph.notes[a.i]!.title.localeCompare(graph.notes[b.i]!.title, 'pt-BR'));
  return scored.slice(0, limit).map((s) => s.i);
}
