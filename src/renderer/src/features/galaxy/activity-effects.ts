import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  MeshBasicMaterial,
  OctahedronGeometry,
  Quaternion,
  Vector3,
  type Object3D,
  type ShaderMaterial,
} from 'three';
import type { Animator } from './ambient';
import { haloBuffer } from './effects';
import type { GalaxyProfile } from './quality';

/**
 * Eventos reais na galáxia (Galáxia Viva, G5). Quando o Claude cria ou edita uma nota, uma nave parte da borda da
 * galáxia, se aproxima do planeta, emite um feixe enquanto o arquivo é alterado e, quando a alteração chega ao disco,
 * o planeta pulsa. Edições seguidas viram uma fila na mesma nave (agrupamento). Notas alteradas por outros meios só
 * pulsam. Tudo vem de eventos que o Nexus já recebe: nenhuma chamada a mais.
 */

/** Posição e tamanho de um planeta (ou da estrela de um sistema, para notas que ainda não existem). */
export interface Spot {
  x: number;
  y: number;
  z: number;
  size: number;
}

export interface ActivityDeps {
  material: ShaderMaterial;
  profile: () => GalaxyProfile;
  /** Planeta da nota (caminho relativo ao vault), ou `null` se ela ainda não está na galáxia. */
  locate: (path: string) => Spot | null;
  /** Estrela do sistema onde a nota vai nascer (pasta de primeiro nível), para notas novas. */
  locateSystem: (path: string) => Spot | null;
  radius: () => number;
  rand: () => number;
  /** Registra a animação no relógio ambiente; devolve a função que a remove. */
  start: (animator: Animator) => () => void;
}

/** Limites fixos dos buffers (o perfil decide quantos são usados). */
const MAX_SHIPS = 4;
const MAX_PULSES = 24;
const BEAM_PARTICLES = 10;
const JOBS_PER_SHIP = 6;
const MIN_BEAM_S = 0.9;
const MAX_BEAM_S = 10;
const PULSE_S = 1.6;
const SAME_NOTE_PULSE_GAP_MS = 4000;
const PENDING_PULSE_S = 4;
const FORWARD = new Vector3(0, 0, 1);

export type PulseKind = 'activity' | 'create' | 'update';
const PULSE_COLORS: Record<PulseKind, string> = { activity: '#8fe9ff', create: '#ffd98a', update: '#ffffff' };
const PULSE_SCALE: Record<PulseKind, number> = { activity: 1, create: 1.4, update: 0.7 };

interface Job {
  path: string;
  done: boolean;
  /** Direção (unitária) de onde a nave se aproxima do planeta, fixada quando ela parte para ele. */
  side: Vector3 | null;
}

interface Ship {
  pos: Vector3;
  dir: Vector3;
  from: Vector3;
  ctrl: Vector3;
  to: Vector3;
  t: number;
  duration: number;
  state: 'arriving' | 'beaming' | 'leaving';
  jobs: Job[];
  beam: number;
}

interface Pulse {
  path: string;
  kind: PulseKind;
  spot: Spot | null;
  t: number;
  /** Quanto ainda espera a nota aparecer na galáxia (nota nova, antes de o grafo recarregar). */
  wait: number;
}

export class ActivityLayer {
  readonly objects: Object3D[];
  private readonly hulls: InstancedMesh;
  private readonly glow: ReturnType<typeof haloBuffer>;
  private readonly pulseHalo: ReturnType<typeof haloBuffer>;
  private readonly beamLine: LineSegments;
  private readonly beamPositions = new Float32Array(MAX_SHIPS * 6);
  private readonly beamColors = new Float32Array(MAX_SHIPS * 6);
  private ships: Ship[] = [];
  private pulses: Pulse[] = [];
  private readonly lastPulse = new Map<string, number>();
  private stop: (() => void) | null = null;
  /** Totais desde a abertura (expostos para os testes). */
  readonly stats = { ships: 0, pulses: 0, grouped: 0 };

  constructor(private readonly deps: ActivityDeps) {
    const geometry = new OctahedronGeometry(0.55, 0);
    geometry.scale(0.7, 0.45, 1.6); // casco alongado, a ponta para +Z
    this.hulls = new InstancedMesh(geometry, new MeshBasicMaterial({ color: 0xcff6ff }), MAX_SHIPS);
    this.hulls.count = 0;
    this.hulls.frustumCulled = false;
    // Por nave: o brilho do motor, as partículas do feixe e o ponto onde o feixe toca o planeta.
    this.glow = haloBuffer(MAX_SHIPS * (BEAM_PARTICLES + 2), deps.material);
    this.glow.points.frustumCulled = false;
    this.pulseHalo = haloBuffer(MAX_PULSES * 2, deps.material);
    this.pulseHalo.points.frustumCulled = false;
    const beam = new Color('#8fe9ff');
    for (let i = 0; i < MAX_SHIPS * (BEAM_PARTICLES + 2); i++) this.glow.set(i, { x: 0, y: 0, z: 0 }, beam, 1.6, 0);
    const lineGeometry = new BufferGeometry();
    lineGeometry.setAttribute('position', new BufferAttribute(this.beamPositions, 3));
    lineGeometry.setAttribute('color', new BufferAttribute(this.beamColors, 3));
    this.beamLine = new LineSegments(
      lineGeometry,
      new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending }),
    );
    this.beamLine.frustumCulled = false;
    this.objects = [this.hulls, this.beamLine, this.glow.points, this.pulseHalo.points];
  }

  get activeShips(): number {
    return this.ships.length;
  }

  get pendingJobs(): number {
    return this.ships.reduce((n, s) => n + s.jobs.length, 0);
  }

  /** O Claude começou a criar ou editar a nota. */
  claudeEdit(path: string): void {
    const key = path.toLowerCase();
    if (this.ships.some((s) => s.jobs.some((j) => !j.done && j.path.toLowerCase() === key))) return;
    const limit = this.deps.profile().limits.activityShips;
    const job: Job = { path, done: false, side: null };
    const working = this.ships.filter((s) => s.state !== 'leaving');
    if (working.length < limit && this.ships.length < MAX_SHIPS) {
      this.ships.push(this.spawn(job));
      this.stats.ships++;
    } else {
      // Agrupa: a nave com a menor fila leva mais esta (ou, sem espaço, a nota só pulsa).
      const ship = working.sort((a, b) => a.jobs.length - b.jobs.length)[0];
      if (ship && ship.jobs.length < JOBS_PER_SHIP) {
        ship.jobs.push(job);
        this.stats.grouped++;
      } else {
        this.pulse(path, 'activity', true);
      }
    }
    this.run();
  }

  /** Notas alteradas no disco. `existed`: a nota já estava na galáxia (senão, foi criada agora). */
  notesChanged(changes: Array<{ path: string; existed: boolean }>): void {
    for (const { path, existed } of changes) {
      const key = path.toLowerCase();
      const job = this.ships.flatMap((s) => s.jobs).find((j) => !j.done && j.path.toLowerCase() === key);
      if (job) job.done = true;
      else this.pulse(path, existed ? 'update' : 'create', false);
    }
    this.run();
  }

  private pulse(path: string, kind: PulseKind, force: boolean): void {
    const key = path.toLowerCase();
    const now = performance.now();
    if (!force && now - (this.lastPulse.get(key) ?? -Infinity) < SAME_NOTE_PULSE_GAP_MS) return;
    if (this.pulses.length >= Math.min(MAX_PULSES, this.deps.profile().limits.pulses)) return;
    this.lastPulse.set(key, now);
    this.pulses.push({ path, kind, spot: null, t: 0, wait: PENDING_PULSE_S });
    this.stats.pulses++;
  }

  private run(): void {
    if (this.stop || (this.ships.length === 0 && this.pulses.length === 0)) return;
    this.stop = this.deps.start(this.animator);
  }

  dispose(): void {
    this.stop?.();
    this.stop = null;
    this.ships = [];
    this.pulses = [];
  }

  // ---- movimento ----

  private spawn(job: Job): Ship {
    const r = this.deps.radius() * 1.15;
    const a = this.deps.rand() * Math.PI * 2;
    const pos = new Vector3(Math.cos(a) * r, 25 + this.deps.rand() * 20, Math.sin(a) * r);
    const ship: Ship = {
      pos,
      dir: new Vector3(1, 0, 0),
      from: pos.clone(),
      ctrl: pos.clone(),
      to: pos.clone(),
      t: 0,
      duration: 1,
      state: 'arriving',
      jobs: [job],
      beam: 0,
    };
    this.leg(ship, 45);
    return ship;
  }

  /** Onde a nota está agora (o planeta, ou a estrela do sistema se ela ainda vai nascer). */
  private spotOf(path: string): Spot {
    return this.deps.locate(path) ?? this.deps.locateSystem(path) ?? { x: 0, y: 0, z: 0, size: 1.5 };
  }

  /** Ponto de onde a nave trabalha: ao lado do planeta, um pouco acima, do lado por onde chegou. */
  private station(job: Job, spot: Spot, from: Vector3): Vector3 {
    if (!job.side) {
      job.side = new Vector3(from.x - spot.x, 0, from.z - spot.z);
      if (job.side.lengthSq() < 1e-6) job.side.set(1, 0, 0);
      job.side.normalize();
    }
    return new Vector3(spot.x, spot.y + spot.size * 1.3 + 0.8, spot.z).addScaledVector(job.side, spot.size * 3 + 2.5);
  }

  /** Começa a ida até a próxima nota da fila. */
  private leg(ship: Ship, speed: number): void {
    const job = ship.jobs[0]!;
    ship.from.copy(ship.pos);
    ship.to.copy(this.station(job, this.spotOf(job.path), ship.pos));
    const dist = ship.from.distanceTo(ship.to);
    ship.ctrl.copy(ship.from).add(ship.to).multiplyScalar(0.5);
    ship.ctrl.y += dist * 0.18;
    ship.t = 0;
    ship.duration = Math.min(4.5, Math.max(0.8, dist / speed));
    ship.state = 'arriving';
    ship.beam = 0;
  }

  private leave(ship: Ship): void {
    const r = this.deps.radius() * 1.2;
    const a = Math.atan2(ship.pos.z, ship.pos.x) + (this.deps.rand() - 0.5);
    ship.from.copy(ship.pos);
    ship.to.set(Math.cos(a) * r, ship.pos.y + 30, Math.sin(a) * r);
    ship.ctrl.copy(ship.from).add(ship.to).multiplyScalar(0.5);
    ship.ctrl.y += 15;
    ship.t = 0;
    ship.duration = 3;
    ship.state = 'leaving';
  }

  private readonly animator: Animator = {
    fast: true,
    update: (dt) => {
      const m = new Matrix4();
      const q = new Quaternion();
      const one = new Vector3(1, 1, 1);
      const prev = new Vector3();
      const contact = new Vector3();
      const beamColor = new Color('#8fe9ff');
      const g = this.glow;

      for (let i = this.ships.length - 1; i >= 0; i--) {
        const ship = this.ships[i]!;
        prev.copy(ship.pos);
        const job = ship.jobs[0];
        if (ship.state !== 'leaving' && job) {
          // O planeta pode mudar de lugar quando o grafo recarrega (nota nova): o destino acompanha.
          ship.to.copy(this.station(job, this.spotOf(job.path), ship.from));
        }
        if (ship.state === 'beaming' && job) {
          ship.beam += dt;
          ship.pos.copy(ship.to);
          ship.pos.y += Math.sin(ship.beam * 2.4) * 0.25;
          if ((job.done && ship.beam >= MIN_BEAM_S) || ship.beam >= MAX_BEAM_S) {
            this.pulse(job.path, this.deps.locate(job.path) ? 'activity' : 'create', true);
            ship.jobs.shift();
            if (ship.jobs.length > 0) this.leg(ship, 35);
            else this.leave(ship);
          }
        } else {
          ship.t = Math.min(1, ship.t + dt / ship.duration);
          const t = ship.state === 'leaving' ? ship.t * ship.t : 1 - (1 - ship.t) ** 2;
          const k = 1 - t;
          ship.pos
            .copy(ship.from)
            .multiplyScalar(k * k)
            .addScaledVector(ship.ctrl, 2 * k * t)
            .addScaledVector(ship.to, t * t);
          if (ship.t >= 1) {
            if (ship.state === 'leaving') {
              this.ships.splice(i, 1);
              continue;
            }
            ship.state = 'beaming';
            ship.beam = 0;
          }
        }
        if (ship.state === 'beaming' && ship.jobs[0]) {
          const spot = this.spotOf(ship.jobs[0].path);
          ship.dir.set(spot.x - ship.pos.x, spot.y - ship.pos.y, spot.z - ship.pos.z).normalize();
        } else if (prev.distanceToSquared(ship.pos) > 1e-8) ship.dir.subVectors(ship.pos, prev).normalize();
      }

      // Desenho das naves e dos feixes.
      this.hulls.count = this.ships.length;
      g.alphas.fill(0);
      this.beamColors.fill(0);
      this.ships.forEach((ship, i) => {
        const fade = ship.state === 'leaving' ? 1 - ship.t : 1;
        q.setFromUnitVectors(FORWARD, ship.dir);
        this.hulls.setMatrixAt(i, m.compose(ship.pos, q, one.setScalar(Math.max(0.01, fade))));
        const base = i * (BEAM_PARTICLES + 2);
        g.positions.set([ship.pos.x, ship.pos.y, ship.pos.z], base * 3);
        g.sizes[base] = 4;
        g.alphas[base] = 0.85 * fade;
        const job = ship.jobs[0];
        if (ship.state !== 'beaming' || !job) return;
        const spot = this.spotOf(job.path);
        contact
          .set(ship.pos.x - spot.x, ship.pos.y - spot.y, ship.pos.z - spot.z)
          .setLength(spot.size)
          .add(spot);
        const on = Math.min(1, ship.beam * 4);
        for (let k = 0; k < BEAM_PARTICLES; k++) {
          const u = (ship.beam * 1.8 + k / BEAM_PARTICLES) % 1;
          const slot = base + 1 + k;
          g.positions.set(
            [
              ship.pos.x + (contact.x - ship.pos.x) * u,
              ship.pos.y + (contact.y - ship.pos.y) * u,
              ship.pos.z + (contact.z - ship.pos.z) * u,
            ],
            slot * 3,
          );
          g.sizes[slot] = 1.8;
          g.alphas[slot] = on * 0.8 * Math.sin(Math.PI * u);
        }
        const hit = base + BEAM_PARTICLES + 1;
        g.positions.set([contact.x, contact.y, contact.z], hit * 3);
        g.sizes[hit] = spot.size * 3.2;
        g.alphas[hit] = on * (0.45 + 0.25 * Math.sin(ship.beam * 9));
        const glowLine = on * (0.55 + 0.25 * Math.sin(ship.beam * 7));
        this.beamPositions.set([ship.pos.x, ship.pos.y, ship.pos.z, contact.x, contact.y, contact.z], i * 6);
        this.beamColors.set(
          [
            beamColor.r * glowLine,
            beamColor.g * glowLine,
            beamColor.b * glowLine,
            beamColor.r * glowLine * 0.6,
            beamColor.g * glowLine * 0.6,
            beamColor.b * glowLine * 0.6,
          ],
          i * 6,
        );
      });
      this.hulls.instanceMatrix.needsUpdate = true;
      g.touch();
      this.beamLine.geometry.getAttribute('position').needsUpdate = true;
      this.beamLine.geometry.getAttribute('color').needsUpdate = true;

      // Pulsos: um clarão rápido e uma onda de luz que cresce e apaga.
      const p = this.pulseHalo;
      p.alphas.fill(0);
      const c = new Color();
      for (let i = this.pulses.length - 1; i >= 0; i--) {
        const pulse = this.pulses[i]!;
        pulse.spot ??= this.deps.locate(pulse.path);
        if (!pulse.spot) {
          pulse.wait -= dt;
          if (pulse.wait <= 0) this.pulses.splice(i, 1);
          continue;
        }
        pulse.t += dt / PULSE_S;
        if (pulse.t >= 1) this.pulses.splice(i, 1);
      }
      this.pulses.forEach((pulse, i) => {
        if (!pulse.spot || i >= MAX_PULSES) return;
        const s = pulse.spot.size * PULSE_SCALE[pulse.kind];
        const t = pulse.t;
        c.set(PULSE_COLORS[pulse.kind]);
        p.set(i * 2, pulse.spot, c, s * (4 + 12 * (1 - (1 - t) ** 3)), 0.7 * (1 - t) ** 2);
        p.set(i * 2 + 1, pulse.spot, c, s * 5, Math.max(0, 1 - t * 2.5) * 0.95);
      });
      p.touch();

      const busy = this.ships.length > 0 || this.pulses.length > 0;
      if (!busy) this.stop = null;
      return busy;
    },
  };
}
