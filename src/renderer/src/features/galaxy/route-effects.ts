import { Color, Vector3, type ShaderMaterial } from 'three';
import type { GalaxyGraph } from '@shared/knowledge';
import { hash01 } from '@shared/planets';
import type { Animator } from './ambient';
import { haloBuffer, type Effect } from './effects';
import type { GalaxyLayout, PlacedNote } from './layout';
import type { GalaxyProfile } from './quality';

/** Fluxo de luz nas rotas e cometas entre sistemas (Galáxia Viva, G3). Só usa o grafo e o layout já carregados. */

/**
 * Rotas que ganham fluxo de luz, até o limite do perfil: primeiro as que ligam sistemas diferentes, depois as das notas
 * mais conectadas. Em regiões muito ligadas, isso evita uma rota piscando em cima da outra.
 */
export function pickFlowRoutes(graph: GalaxyGraph, layout: GalaxyLayout, limit: number): number[] {
  const scored = graph.links.map(([a, b], i) => {
    const cross = layout.notes[a]!.system !== layout.notes[b]!.system;
    return { i, score: (cross ? 1000 : 0) + graph.notes[a]!.degree + graph.notes[b]!.degree };
  });
  scored.sort((x, y) => y.score - x.score || x.i - y.i);
  return scored.slice(0, Math.max(0, limit)).map((s) => s.i);
}

/**
 * Pares de notas que os cometas percorrem: links entre sistemas diferentes e, depois, notas de sistemas diferentes que
 * compartilham uma tag. Sem repetição; poucos pares por tag, para uma tag muito usada não dominar o céu.
 */
export function cometPairs(graph: GalaxyGraph, layout: GalaxyLayout, max = 300): Array<[number, number]> {
  const seen = new Set<string>();
  const out: Array<[number, number]> = [];
  const add = (a: number, b: number): boolean => {
    if (a === b || layout.notes[a]!.system === layout.notes[b]!.system || out.length >= max) return false;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(key)) return false;
    seen.add(key);
    out.push([a, b]);
    return true;
  };
  for (const [a, b] of graph.links) add(a, b);
  const byTag = new Map<string, number[]>();
  graph.notes.forEach((n, i) => {
    for (const t of n.tags) {
      const key = t.toLowerCase();
      const list = byTag.get(key);
      if (list) list.push(i);
      else byTag.set(key, [i]);
    }
  });
  for (const tag of [...byTag.keys()].sort()) {
    const notes = byTag.get(tag)!;
    let perTag = 0;
    for (let x = 0; x < notes.length && perTag < 4; x++)
      for (let y = x + 1; y < notes.length && perTag < 4; y++) if (add(notes[x]!, notes[y]!)) perTag++;
  }
  return out;
}

const FLOW_SPEED = 7;

/** Um ponto de luz correndo por rota escolhida, num sentido sorteado (a direção real dos links chega na G6). */
export function createFlows(
  graph: GalaxyGraph,
  layout: GalaxyLayout,
  profile: GalaxyProfile,
  material: ShaderMaterial,
): Effect | null {
  const routes = pickFlowRoutes(graph, layout, profile.limits.flowingRoutes);
  if (routes.length === 0) return null;
  const halo = haloBuffer(routes.length, material);
  halo.points.frustumCulled = false;
  const color = new Color();
  const other = new Color();
  const flows: Array<{ a: PlacedNote; b: PlacedNote; u: number; rate: number }> = routes.map((r, k) => {
    const [i, j] = graph.links[r]!;
    const forward = hash01(`flow:${i}:${j}`) < 0.5;
    const a = layout.notes[forward ? i : j]!;
    const b = layout.notes[forward ? j : i]!;
    color.set(layout.systems[a.system]!.color).lerp(other.set(layout.systems[b.system]!.color), 0.5);
    color.lerp(other.set('#ffffff'), 0.35);
    const length = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
    halo.set(k, a, color, 2.4, 0);
    return { a, b, u: hash01(`phase:${i}:${j}`), rate: FLOW_SPEED / length };
  });
  const animator: Animator = {
    update(dt) {
      flows.forEach((f, k) => {
        f.u = (f.u + f.rate * dt) % 1;
        const { a, b, u } = f;
        halo.positions.set([a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u], k * 3);
        // Acende ao sair e apaga ao chegar.
        halo.alphas[k] = Math.sin(Math.PI * u) * 0.75;
      });
      halo.touch();
      return true;
    },
  };
  return { objects: [halo.points], animator };
}

const COMET_TRAIL = 14;
const COMET_TRAIL_STEP = 0.014;

interface Comet {
  from: Vector3;
  ctrl: Vector3;
  to: Vector3;
  t: number;
  duration: number;
}

function bezier(out: Vector3, c: Comet, t: number): Vector3 {
  const k = 1 - t;
  return out
    .copy(c.from)
    .multiplyScalar(k * k)
    .addScaledVector(c.ctrl, 2 * k * t)
    .addScaledVector(c.to, t * t);
}

/**
 * Cometas de tempos em tempos entre notas de sistemas diferentes (ligadas por link ou por tag), num arco acima do
 * plano da galáxia, com cauda. No máximo o número do perfil ao mesmo tempo.
 */
export function createComets(
  graph: GalaxyGraph,
  layout: GalaxyLayout,
  profile: () => GalaxyProfile,
  material: ShaderMaterial,
  rand: () => number,
): Effect | null {
  const pairs = cometPairs(graph, layout);
  const max = profile().limits.comets;
  if (pairs.length === 0 || max === 0) return null;
  const halo = haloBuffer(max * COMET_TRAIL, material);
  halo.points.frustumCulled = false;
  const head = new Color('#e3f1ff');
  const tail = new Color('#7fb8ff');
  const c = new Color();
  for (let k = 0; k < max * COMET_TRAIL; k++) {
    const step = k % COMET_TRAIL;
    c.copy(head).lerp(tail, step / COMET_TRAIL);
    halo.set(k, { x: 0, y: 0, z: 0 }, c, step === 0 ? 5 : 1.2 + 3 * (1 - step / COMET_TRAIL), 0);
  }
  const comets: Comet[] = [];
  let wait = profile().cometEverySec * (0.2 + 0.5 * rand());
  const p = new Vector3();

  const animator: Animator = {
    get fast() {
      return comets.length > 0;
    },
    update(dt) {
      wait -= dt;
      if (wait <= 0) {
        wait = profile().cometEverySec * (0.6 + 0.8 * rand());
        if (comets.length < max) {
          const [i, j] = pairs[Math.floor(rand() * pairs.length)]!;
          const a = layout.notes[i]!;
          const b = layout.notes[j]!;
          const from = new Vector3(a.x, a.y, a.z);
          const to = new Vector3(b.x, b.y, b.z);
          const dist = from.distanceTo(to);
          const ctrl = from.clone().add(to).multiplyScalar(0.5);
          ctrl.y += dist * 0.22;
          comets.push({ from, ctrl, to, t: 0, duration: Math.min(7, Math.max(2.5, dist / 30)) });
        }
      }
      for (let n = comets.length - 1; n >= 0; n--) {
        comets[n]!.t += dt / comets[n]!.duration;
        if (comets[n]!.t > 1 + COMET_TRAIL * COMET_TRAIL_STEP) comets.splice(n, 1);
      }
      for (let slot = 0; slot < max; slot++) {
        const comet = comets[slot];
        for (let step = 0; step < COMET_TRAIL; step++) {
          const k = slot * COMET_TRAIL + step;
          const t = comet ? comet.t - step * COMET_TRAIL_STEP : -1;
          if (!comet || t < 0 || t > 1) {
            halo.alphas[k] = 0;
            continue;
          }
          bezier(p, comet, t);
          halo.positions.set([p.x, p.y, p.z], k * 3);
          // Acende ao partir, apaga ao chegar; a cauda vai sumindo.
          const fade = Math.min(1, t * 6, (1 - t) * 6);
          halo.alphas[k] = fade * 0.9 * (1 - step / COMET_TRAIL) ** 1.4;
        }
      }
      halo.touch();
      return true;
    },
  };
  return { objects: [halo.points], animator };
}
