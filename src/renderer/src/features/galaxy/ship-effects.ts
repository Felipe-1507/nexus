import {
  ConeGeometry,
  Color,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
  type ShaderMaterial,
} from 'three';
import type { Animator } from './ambient';
import { haloBuffer, type Effect } from './effects';
import type { GalaxyLayout } from './layout';
import type { GalaxyProfile } from './quality';
import { exhaust, Fleet, LIVERIES, MODEL_SCALE, type ShipModel } from './ship-models';

/**
 * Naves ambientais (Galáxia Viva, G4): poucas naves cruzando a galáxia, ora visitando um sistema (dão algumas voltas em
 * volta da estrela), ora vagando entre eles. Desenhadas todas de uma vez, com um rastro de luz discreto.
 */

const SHIP_SPEED = 10;
const TRAIL = 12;
const TRAIL_EVERY_S = 0.12;
/** Alta/Ultra: rastro mais denso (vira um jato contínuo que se apaga). */
const DETAIL_TRAIL = 30;
const DETAIL_TRAIL_EVERY_S = 0.035;
const FORWARD = new Vector3(0, 0, 1);

export type ShipTarget =
  | { kind: 'visit'; system: number; point: Vector3; center: Vector3; radius: number }
  | { kind: 'wander'; point: Vector3 };

/** Raio que contém todos os sistemas (as naves não saem dele). */
export function galaxyRadius(layout: GalaxyLayout): number {
  let r = 30;
  for (const s of layout.systems) r = Math.max(r, Math.hypot(s.x, s.z) + s.extent);
  return r;
}

/**
 * Próximo destino: na maioria das vezes, visitar um sistema (os maiores são mais visitados), chegando pela borda dele;
 * senão, um ponto qualquer do disco da galáxia.
 */
export function planShipTarget(layout: GalaxyLayout, rand: () => number, radius = galaxyRadius(layout)): ShipTarget {
  if (layout.systems.length > 0 && rand() < 0.65) {
    const total = layout.systems.reduce((sum, s) => sum + Math.sqrt(s.count), 0);
    let pick = rand() * total;
    let system = 0;
    for (; system < layout.systems.length - 1; system++) {
      pick -= Math.sqrt(layout.systems[system]!.count);
      if (pick <= 0) break;
    }
    const s = layout.systems[system]!;
    const r = s.extent * (0.7 + 0.3 * rand());
    const a = rand() * Math.PI * 2;
    const center = new Vector3(s.x, s.y, s.z);
    return {
      kind: 'visit',
      system,
      center,
      radius: r,
      point: new Vector3(s.x + Math.cos(a) * r, s.y + (rand() - 0.5) * 4, s.z + Math.sin(a) * r),
    };
  }
  const a = rand() * Math.PI * 2;
  const d = Math.sqrt(rand()) * radius;
  return { kind: 'wander', point: new Vector3(Math.cos(a) * d, (rand() - 0.5) * 30, Math.sin(a) * d) };
}

interface Ship {
  pos: Vector3;
  dir: Vector3;
  from: Vector3;
  ctrl: Vector3;
  target: ShipTarget;
  t: number;
  duration: number;
  /** Voltas em volta da estrela do sistema visitado; `null` = viajando. */
  orbit: { center: Vector3; radius: number; angle: number; speed: number; left: number; y: number } | null;
  trail: Vector3[];
  trailWait: number;
}

export function createShips(
  layout: GalaxyLayout,
  profile: GalaxyProfile,
  material: ShaderMaterial,
  rand: () => number,
): Effect | null {
  const count = profile.limits.ambientShips;
  if (count === 0 || layout.systems.length === 0) return null;
  // A galáxia pode mudar (nota nova): as naves continuam onde estão e passam a usar o layout novo.
  let current = layout;
  let radius = galaxyRadius(layout);

  // Alta/Ultra: naves de verdade (modelos, pinturas e propulsores) com rastro contínuo; nos outros modos, os cones.
  const detailed = profile.planetDetail > 0;
  const TR = detailed ? DETAIL_TRAIL : TRAIL;
  const MODELS: ShipModel[] = ['batedor', 'batedor', 'correio', 'correio', 'cruzador', 'cargueiro'];
  const kinds = Array.from({ length: count }, () => ({
    model: MODELS[Math.floor(rand() * MODELS.length)]!,
    livery: Math.floor(rand() * LIVERIES.length),
  }));
  const fleets = new Map<string, Fleet>();
  const slot: Array<{ fleet: Fleet; index: number }> = [];
  if (detailed) {
    for (const k of kinds) {
      const key = k.model + ':' + k.livery;
      let fleet = fleets.get(key);
      if (!fleet) {
        fleet = new Fleet(k.model, LIVERIES[k.livery]!, count);
        fleets.set(key, fleet);
      }
      slot.push({ fleet, index: fleet.hull.count });
      fleet.count = fleet.hull.count + 1;
    }
  }
  const geometry = new ConeGeometry(0.32, 1.3, 6);
  geometry.rotateX(Math.PI / 2); // a ponta passa a apontar para +Z (a frente da nave)
  const hulls = new InstancedMesh(geometry, new MeshBasicMaterial({ color: 0xffffff }), count);
  hulls.frustumCulled = false;
  if (detailed) hulls.count = 0;
  const halo = haloBuffer(count * TR, material);
  halo.points.frustumCulled = false;
  const engine = new Color('#9fd8ff');
  const tint = new Color();
  const hullColors = ['#e8eeff', '#ffe9c7', '#d9fff1', '#f3dcff'];

  const ships: Ship[] = Array.from({ length: count }, (_, i) => {
    const start = planShipTarget(current, rand, radius).point;
    if (!detailed) hulls.setColorAt(i, tint.set(hullColors[i % hullColors.length]!));
    const flame = detailed ? tint.set(LIVERIES[kinds[i]!.livery]!.engine) : engine;
    const size = detailed ? MODEL_SCALE[kinds[i]!.model] : 1;
    for (let k = 0; k < TR; k++)
      halo.set(i * TR + k, start, flame, (detailed ? 1.6 * size : 2.2) * (1 - k / TR) + 0.5, 0);
    const ship: Ship = {
      pos: start.clone(),
      dir: new Vector3(1, 0, 0),
      from: start.clone(),
      ctrl: start.clone(),
      target: { kind: 'wander', point: start.clone() },
      t: 1,
      duration: 1,
      orbit: null,
      trail: [],
      trailWait: 0,
    };
    travel(ship);
    return ship;
  });

  /** Parte do ponto atual para um destino novo, em curva. */
  function travel(ship: Ship): void {
    ship.target = planShipTarget(current, rand, radius);
    ship.from.copy(ship.pos);
    const to = ship.target.point;
    const dist = ship.from.distanceTo(to);
    const side = new Vector3(-(to.z - ship.from.z), 0, to.x - ship.from.x).normalize();
    ship.ctrl
      .copy(ship.from)
      .add(to)
      .multiplyScalar(0.5)
      .addScaledVector(side, (rand() - 0.5) * dist * 0.6);
    ship.ctrl.y += (rand() - 0.3) * dist * 0.15;
    ship.t = 0;
    ship.duration = Math.min(45, Math.max(3, dist / SHIP_SPEED));
    ship.orbit = null;
  }

  const m = new Matrix4();
  const q = new Quaternion();
  const one = new Vector3(1, 1, 1);
  const prev = new Vector3();
  const scale = new Vector3();
  const exhaustAt = new Vector3();
  let clock = 0;

  const animator: Animator = {
    update(dt) {
      clock += dt;
      ships.forEach((ship, i) => {
        prev.copy(ship.pos);
        if (ship.orbit) {
          const o = ship.orbit;
          o.angle += o.speed * dt;
          o.left -= dt;
          ship.pos.set(o.center.x + Math.cos(o.angle) * o.radius, o.y, o.center.z + Math.sin(o.angle) * o.radius);
          if (o.left <= 0) travel(ship);
        } else {
          ship.t = Math.min(1, ship.t + dt / ship.duration);
          const t = ship.t;
          const k = 1 - t;
          ship.pos
            .copy(ship.from)
            .multiplyScalar(k * k)
            .addScaledVector(ship.ctrl, 2 * k * t)
            .addScaledVector(ship.target.point, t * t);
          if (t >= 1) {
            if (ship.target.kind === 'visit') {
              const { center, radius: r } = ship.target;
              ship.orbit = {
                center,
                radius: r,
                angle: Math.atan2(ship.pos.z - center.z, ship.pos.x - center.x),
                speed: ((SHIP_SPEED * 0.6) / r) * (rand() < 0.5 ? -1 : 1),
                left: 5 + rand() * 6,
                y: ship.pos.y,
              };
            } else travel(ship);
          }
        }
        const step = prev.distanceToSquared(ship.pos);
        if (step > 1e-8) ship.dir.subVectors(ship.pos, prev).normalize();
        q.setFromUnitVectors(FORWARD, ship.dir);
        let tail = ship.pos;
        if (detailed) {
          const kind = kinds[i]!;
          const sc = MODEL_SCALE[kind.model];
          m.compose(ship.pos, q, scale.setScalar(sc));
          const { fleet, index } = slot[i]!;
          // Acelera viajando, quase desliga dando voltas no sistema.
          const throttle = ship.orbit ? 0.45 : 1;
          fleet.setShip(index, m, throttle, Math.sin(clock * 37 + i * 3.1) * 0.5 + Math.sin(clock * 23 + i) * 0.5);
          tail = exhaustAt.copy(exhaust(kind.model)).multiplyScalar(sc).applyQuaternion(q).add(ship.pos);
        } else hulls.setMatrixAt(i, m.compose(ship.pos, q, one));

        // Rastro: guarda posições de tempos em tempos; o mais novo fica atrás do motor.
        ship.trailWait -= dt;
        if (ship.trailWait <= 0) {
          ship.trailWait = detailed ? DETAIL_TRAIL_EVERY_S : TRAIL_EVERY_S;
          ship.trail.unshift(tail.clone());
          if (ship.trail.length > TR) ship.trail.pop();
        }
        for (let k = 0; k < TR; k++) {
          const p = k === 0 ? tail : ship.trail[k - 1];
          const slot = i * TR + k;
          if (!p) {
            halo.alphas[slot] = 0;
            continue;
          }
          halo.positions.set([p.x, p.y, p.z], slot * 3);
          halo.alphas[slot] = detailed
            ? (k === 0 ? 0.9 : 0.35) * (1 - k / TR) ** 1.6
            : (k === 0 ? 0.8 : 0.45) * (1 - k / TRAIL);
        }
      });
      hulls.instanceMatrix.needsUpdate = true;
      for (const fleet of fleets.values()) fleet.touch();
      halo.touch();
      return true;
    },
  };
  return {
    objects: [hulls, halo.points, ...[...fleets.values()].flatMap((f) => f.objects)],
    animator,
    setLayout(next) {
      current = next;
      radius = galaxyRadius(next);
    },
  };
}
