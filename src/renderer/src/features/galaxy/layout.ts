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
 * - Os sistemas se distribuem em braços de espiral, como numa galáxia: os maiores mais perto do sol, cada um na menor
 *   distância ao longo do seu braço em que não encosta em nenhum dos anteriores. Dois sistemas nunca se sobrepõem e o
 *   conjunto fica redondo.
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
/** Braços da espiral e quanto cada um se enrola (volta em radianos por `SPIRAL_SCALE` de distância, em escala log). */
const ARMS = 3;
const SPIRAL_TWIST = 1.6;
const SPIRAL_SCALE = 40;
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
  // Até onde cada braço já foi preenchido: o próximo sistema do braço começa dali (e vai para fora).
  const armReach = new Array<number>(ARMS).fill(0);
  let colorIndex = 0;

  names.forEach((name, k) => {
    const members = groups.get(name)!;
    const ranked = [...members].sort(
      (a, b) =>
        graph.notes[b]!.degree - graph.notes[a]!.degree || graph.notes[a]!.path.localeCompare(graph.notes[b]!.path),
    );
    const sizes = ranked.map((i) => planetSize(graph.notes[i]!.degree, graph.notes[i]!.chars));
    const isCore = name === '' && k === 0;
    // O núcleo gira em volta do sol: a primeira órbita começa depois dele.
    const plan = planOrbits(sizes, isCore ? SUN_RADIUS + 1.5 : 0);
    const extent = plan.extent;
    let x = 0;
    let z = 0;
    if (!isCore) {
      // Posição ao longo do braço: o ângulo cresce com a distância (espiral logarítmica), com um leve desvio por
      // sistema para os braços não parecerem régua.
      // Cada sistema vai para o braço menos preenchido até agora: os braços crescem juntos e o conjunto fica redondo.
      const mine = armReach.indexOf(Math.min(...armReach));
      const phase = (mine / ARMS) * Math.PI * 2 + (hash01(`arm:${name}`) - 0.5) * 0.5;
      const at = (d: number) => {
        const angle = phase + SPIRAL_TWIST * Math.log1p(d / SPIRAL_SCALE);
        return { x: Math.cos(angle) * d, z: Math.sin(angle) * d };
      };
      // Sai do ponto onde o braço parou e se afasta do sol até não encostar em nenhum sistema já colocado.
      const clear = (d: number) => {
        const p = at(d);
        return systems.every((o) => Math.hypot(p.x - o.x, p.z - o.z) >= o.extent + extent + SYSTEM_MARGIN);
      };
      let d = Math.max(armReach[mine]!, SUN_CLEAR + extent);
      while (!clear(d)) d += PUSH_STEP;
      armReach[mine] = d;
      ({ x, z } = at(d));
    }
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
