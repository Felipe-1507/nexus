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

/** Conexão importante (brilho especial na rota): as duas notas se citam, ou ela liga duas notas centrais. */
export function isImportantRoute(graph: GalaxyGraph, r: number): boolean {
  const [a, b] = graph.links[r]!;
  return graph.directions?.[r] === 3 || Math.min(graph.notes[a]!.degree, graph.notes[b]!.degree) >= 4;
}

/**
 * Um ponto de luz correndo por rota escolhida, de quem cita para quem é citado; nos dois sentidos quando as notas se
 * citam. O limite do perfil vale para o total de pontos.
 */
export function createFlows(
  graph: GalaxyGraph,
  layout: GalaxyLayout,
  profile: GalaxyProfile,
  material: ShaderMaterial,
): Effect | null {
  const limit = profile.limits.flowingRoutes;
  const routes = pickFlowRoutes(graph, layout, limit);
  if (routes.length === 0) return null;
  // Sentido real do link: quem cita → quem é citado. Se as duas notas se citam, a luz corre nos dois sentidos.
  const legs: Array<[number, number, number]> = [];
  for (const r of routes) {
    const [i, j] = graph.links[r]!;
    const dir = graph.directions?.[r] ?? (hash01(`flow:${i}:${j}`) < 0.5 ? 1 : 2);
    if (dir & 1) legs.push([i, j, r]);
    if (dir & 2) legs.push([j, i, r]);
  }
  legs.splice(limit);
  const halo = haloBuffer(legs.length, material);
  halo.points.frustumCulled = false;
  const color = new Color();
  const other = new Color();
  const flows: Array<{ a: PlacedNote; b: PlacedNote; u: number; rate: number }> = legs.map(([i, j], k) => {
    const a = layout.notes[i]!;
    const b = layout.notes[j]!;
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
  if (profile().planetDetail > 0) return createRealComets(pairs, layout, profile, material, rand);
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

/** Alta/Ultra: partículas de cada cometa (cabeleira, cauda de gás e cauda de poeira). */
const COMA = 4;
const ION = 34;
const DUST = 30;
const PER_COMET = COMA + ION + DUST;

/**
 * Cometas de verdade: núcleo pequeno com cabeleira brilhante, cauda de gás azulada e reta, sempre apontando para longe
 * do centro da galáxia (como o vento solar), e cauda de poeira dourada, larga e curva, que segue o caminho percorrido.
 */
function createRealComets(
  pairs: Array<[number, number]>,
  layout: GalaxyLayout,
  profile: () => GalaxyProfile,
  material: ShaderMaterial,
  rand: () => number,
): Effect {
  const max = profile().limits.comets;
  const halo = haloBuffer(max * PER_COMET, material);
  halo.points.frustumCulled = false;
  const coma = new Color('#f4fbff');
  const ion = new Color('#6fb6ff');
  const ionFar = new Color('#3a5cff');
  const dust = new Color('#ffd9a0');
  const dustFar = new Color('#b8743a');
  const c = new Color();
  const jitter = Array.from({ length: max * PER_COMET }, () => [rand() - 0.5, rand() - 0.5, rand() - 0.5]);
  for (let slot = 0; slot < max; slot++) {
    for (let k = 0; k < PER_COMET; k++) {
      const i = slot * PER_COMET + k;
      if (k < COMA) halo.set(i, { x: 0, y: 0, z: 0 }, coma, [3.2, 6, 10, 16][k]!, 0);
      else if (k < COMA + ION) {
        const u = (k - COMA) / ION;
        halo.set(i, { x: 0, y: 0, z: 0 }, c.copy(ion).lerp(ionFar, u), 2.6 - 1.4 * u, 0);
      } else {
        const u = (k - COMA - ION) / DUST;
        halo.set(i, { x: 0, y: 0, z: 0 }, c.copy(dust).lerp(dustFar, u), 3 + 5 * u, 0);
      }
    }
  }
  const comets: Comet[] = [];
  let wait = profile().cometEverySec * (0.2 + 0.5 * rand());
  const p = new Vector3();
  const q = new Vector3();
  const away = new Vector3();
  const side = new Vector3();
  const UP = new Vector3(0, 1, 0);
  const SPAN = 0.16;

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
          comets.push({ from, ctrl, to, t: 0, duration: Math.min(9, Math.max(3.5, dist / 24)) });
        }
      }
      for (let n = comets.length - 1; n >= 0; n--) {
        comets[n]!.t += dt / comets[n]!.duration;
        if (comets[n]!.t > 1.05) comets.splice(n, 1);
      }
      halo.alphas.fill(0);
      for (let slot = 0; slot < max; slot++) {
        const comet = comets[slot];
        if (!comet) continue;
        const t = Math.min(1, comet.t);
        const fade = Math.min(1, t * 5, (1.05 - comet.t) * 6);
        bezier(p, comet, t);
        const dist = comet.from.distanceTo(comet.to);
        const len = Math.max(6, dist * 0.35);
        away.copy(p).setY(p.y * 0.3);
        if (away.lengthSq() < 1e-4) away.set(1, 0, 0);
        away.normalize();
        side.crossVectors(away, UP).normalize();
        const base = slot * PER_COMET;
        for (let k = 0; k < COMA; k++) {
          halo.positions.set([p.x, p.y, p.z], (base + k) * 3);
          halo.alphas[base + k] = fade * [1, 0.7, 0.35, 0.14][k]!;
        }
        for (let k = 0; k < ION; k++) {
          const u = (k + 1) / ION;
          const jt = jitter[base + COMA + k]!;
          const w = 0.25 + u * 0.9;
          q.copy(p)
            .addScaledVector(away, len * u)
            .addScaledVector(side, jt[0]! * w)
            .add(UP.clone().multiplyScalar(jt[1]! * w * 0.6));
          halo.positions.set([q.x, q.y, q.z], (base + COMA + k) * 3);
          halo.alphas[base + COMA + k] = fade * 0.55 * (1 - u) ** 1.2;
        }
        for (let k = 0; k < DUST; k++) {
          const u = (k + 1) / DUST;
          const jt = jitter[base + COMA + ION + k]!;
          // Caminho já percorrido, empurrado para fora aos poucos: a cauda fica larga e curva.
          bezier(q, comet, Math.max(0, t - u * SPAN));
          q.addScaledVector(away, len * 0.45 * u * u)
            .addScaledVector(side, jt[0]! * (0.4 + u * 3))
            .add(UP.clone().multiplyScalar(jt[1]! * (0.3 + u * 1.5)));
          halo.positions.set([q.x, q.y, q.z], (base + COMA + ION + k) * 3);
          halo.alphas[base + COMA + ION + k] = t - u * SPAN < 0 ? 0 : fade * 0.32 * (1 - u) ** 1.5;
        }
      }
      halo.touch();
      return true;
    },
  };
  return { objects: [halo.points], animator };
}
