import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Naves detalhadas dos modos Alta e Ultra. Cada modelo é feito de peças simples (casco, cabine, asas, motores) juntas
 * numa geometria só, com cor por vértice (casco, detalhe e partes escuras) para receber a luz da cena. Luzes de posição
 * e chamas dos propulsores são malhas à parte, que brilham sozinhas (o bloom faz o resto). A frente é +Z.
 */
export type ShipModel = 'batedor' | 'cruzador' | 'cargueiro' | 'correio';

export interface ShipLivery {
  hull: string;
  trim: string;
  /** Cor das chamas e das luzes. */
  engine: string;
}

/** Pinturas possíveis (casco, detalhe, propulsor). */
export const LIVERIES: ShipLivery[] = [
  { hull: '#c9d2e3', trim: '#3d6fd1', engine: '#7fd0ff' },
  { hull: '#e3d6c0', trim: '#c4572e', engine: '#ffb36b' },
  { hull: '#b9c4bd', trim: '#2f9b7a', engine: '#8dffd2' },
  { hull: '#d6cbe3', trim: '#8a4fd1', engine: '#d79bff' },
  { hull: '#8d939e', trim: '#d1b23d', engine: '#ffe08a' },
];

/** Tamanho de cada modelo (escala aplicada à instância). */
export const MODEL_SCALE: Record<ShipModel, number> = { batedor: 1, correio: 1.3, cruzador: 1.7, cargueiro: 2.6 };

interface Part {
  geometry: BufferGeometry;
  /** 0 = casco, 1 = detalhe, 2 = escuro (frestas, bocal). */
  tone: 0 | 1 | 2;
}

const m = new Matrix4();
const q = new Quaternion();
const s = new Vector3();
const p = new Vector3();

function place(
  g: BufferGeometry,
  pos: [number, number, number],
  scale: [number, number, number] = [1, 1, 1],
  rotX = 0,
) {
  q.setFromAxisAngle(new Vector3(1, 0, 0), rotX);
  g.applyMatrix4(m.compose(p.set(...pos), q, s.set(...scale)));
  return g;
}

/** Cilindro deitado ao longo de Z. */
const tube = (r: number, len: number, seg = 10) => new CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2);
const nose = (r: number, len: number, seg = 10) => new ConeGeometry(r, len, seg).rotateX(Math.PI / 2);

/** Peças de cada modelo e a posição dos propulsores (x, y, z, raio). */
function blueprint(model: ShipModel): { parts: Part[]; engines: Array<[number, number, number, number]> } {
  switch (model) {
    case 'batedor':
      return {
        parts: [
          { geometry: place(tube(0.18, 0.9), [0, 0, 0]), tone: 0 },
          { geometry: place(nose(0.18, 0.55), [0, 0, 0.72]), tone: 0 },
          { geometry: place(new SphereGeometry(0.13, 10, 8), [0, 0.12, 0.25], [1, 0.7, 1.6]), tone: 1 },
          { geometry: place(new BoxGeometry(1.15, 0.04, 0.38), [0, -0.02, -0.15]), tone: 1 },
          { geometry: place(new BoxGeometry(0.04, 0.32, 0.3), [0, 0.18, -0.35]), tone: 0 },
          { geometry: place(tube(0.12, 0.15), [0, 0, -0.52]), tone: 2 },
        ],
        engines: [[0, 0, -0.6, 0.11]],
      };
    case 'correio':
      return {
        parts: [
          { geometry: place(new SphereGeometry(0.32, 14, 10), [0, 0, 0.05], [0.9, 0.55, 2]), tone: 0 },
          { geometry: place(new SphereGeometry(0.16, 10, 8), [0, 0.15, 0.35], [1, 0.6, 1.5]), tone: 1 },
          { geometry: place(new BoxGeometry(1.3, 0.05, 0.42), [0, -0.05, -0.2]), tone: 0 },
          { geometry: place(new BoxGeometry(1.32, 0.06, 0.1), [0, -0.05, -0.02]), tone: 1 },
          { geometry: place(tube(0.11, 0.45), [0.42, -0.05, -0.35]), tone: 0 },
          { geometry: place(tube(0.11, 0.45), [-0.42, -0.05, -0.35]), tone: 0 },
          { geometry: place(tube(0.08, 0.1), [0.42, -0.05, -0.62]), tone: 2 },
          { geometry: place(tube(0.08, 0.1), [-0.42, -0.05, -0.62]), tone: 2 },
        ],
        engines: [
          [0.42, -0.05, -0.68, 0.09],
          [-0.42, -0.05, -0.68, 0.09],
        ],
      };
    case 'cruzador':
      return {
        parts: [
          { geometry: place(new BoxGeometry(0.42, 0.24, 1.5), [0, 0, 0]), tone: 0 },
          { geometry: place(nose(0.3, 0.6, 4), [0, 0, 1.05], [1.0, 0.6, 1]), tone: 0 },
          { geometry: place(new BoxGeometry(0.26, 0.16, 0.5), [0, 0.19, -0.1]), tone: 1 },
          { geometry: place(new BoxGeometry(0.12, 0.1, 0.18), [0, 0.3, 0.05]), tone: 2 },
          { geometry: place(new BoxGeometry(1.4, 0.06, 0.6), [0, 0, -0.35]), tone: 0 },
          { geometry: place(new BoxGeometry(1.42, 0.07, 0.08), [0, 0, -0.05]), tone: 1 },
          { geometry: place(tube(0.13, 0.6), [0.55, 0, -0.45]), tone: 0 },
          { geometry: place(tube(0.13, 0.6), [-0.55, 0, -0.45]), tone: 0 },
          { geometry: place(tube(0.16, 0.25), [0, 0, -0.85]), tone: 2 },
        ],
        engines: [
          [0.55, 0, -0.8, 0.11],
          [-0.55, 0, -0.8, 0.11],
          [0, 0, -1.0, 0.14],
        ],
      };
    case 'cargueiro':
      return {
        parts: [
          { geometry: place(new BoxGeometry(0.3, 0.3, 2.0), [0, 0, 0]), tone: 2 },
          { geometry: place(new BoxGeometry(0.62, 0.42, 0.55), [0, 0.04, 1.1]), tone: 0 },
          { geometry: place(new BoxGeometry(0.4, 0.1, 0.2), [0, 0.28, 1.2]), tone: 1 },
          { geometry: place(new BoxGeometry(0.5, 0.5, 0.42), [0.38, 0, 0.35]), tone: 1 },
          { geometry: place(new BoxGeometry(0.5, 0.5, 0.42), [-0.38, 0, 0.35]), tone: 0 },
          { geometry: place(new BoxGeometry(0.5, 0.5, 0.42), [0.38, 0, -0.15]), tone: 0 },
          { geometry: place(new BoxGeometry(0.5, 0.5, 0.42), [-0.38, 0, -0.15]), tone: 1 },
          { geometry: place(new BoxGeometry(0.9, 0.6, 0.45), [0, 0, -0.85]), tone: 0 },
          { geometry: place(tube(0.14, 0.2), [0.25, 0.15, -1.15]), tone: 2 },
          { geometry: place(tube(0.14, 0.2), [-0.25, 0.15, -1.15]), tone: 2 },
          { geometry: place(tube(0.14, 0.2), [0.25, -0.15, -1.15]), tone: 2 },
          { geometry: place(tube(0.14, 0.2), [-0.25, -0.15, -1.15]), tone: 2 },
        ],
        engines: [
          [0.25, 0.15, -1.22, 0.12],
          [-0.25, 0.15, -1.22, 0.12],
          [0.25, -0.15, -1.22, 0.12],
          [-0.25, -0.15, -1.22, 0.12],
        ],
      };
  }
}

/** Casco com cor por vértice: o tom 0 vira a cor do casco, 1 a do detalhe e 2 um cinza escuro. */
function hullGeometry(model: ShipModel, livery: ShipLivery): BufferGeometry {
  const tones = [new Color(livery.hull), new Color(livery.trim), new Color('#262a33')];
  const geometries = blueprint(model).parts.map(({ geometry, tone }) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    g.deleteAttribute('uv');
    const c = tones[tone]!;
    const colors = new Float32Array(g.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
    g.setAttribute('color', new Float32BufferAttribute(colors, 3));
    return g;
  });
  return mergeGeometries(geometries)!;
}

/** Chamas: um cone por propulsor, virado para trás, que pisca e cresce com o "acelerador". */
function flameGeometry(model: ShipModel): BufferGeometry {
  const parts = blueprint(model).engines.map(([x, y, z, r]) =>
    new ConeGeometry(r, r * 9, 10, 1, true).rotateX(-Math.PI / 2).translate(x, y, z - r * 4.5),
  );
  return mergeGeometries(parts)!;
}

/** Bocais acesos (a parte de dentro do propulsor), sempre visíveis. */
function nozzleGeometry(model: ShipModel): BufferGeometry {
  return mergeGeometries(
    blueprint(model).engines.map(([x, y, z, r]) =>
      new SphereGeometry(r * 0.9, 8, 6).scale(1, 1, 0.4).translate(x, y, z),
    ),
  )!;
}

/** Ponto onde fica o motor principal (para o rastro sair dele), em unidades do modelo. */
export function exhaust(model: ShipModel): Vector3 {
  const e = blueprint(model).engines;
  const z = Math.min(...e.map(([, , ez]) => ez));
  return new Vector3(0, 0, z - 0.1);
}

/** Uma frota de um modelo e uma pintura: casco, bocais e chamas, todos instanciados. */
export class Fleet {
  readonly hull: InstancedMesh;
  readonly nozzles: InstancedMesh;
  readonly flames: InstancedMesh;
  private readonly flameMatrix = new Matrix4();
  private readonly tmp = new Matrix4();
  private readonly anchor: number;

  constructor(
    readonly model: ShipModel,
    livery: ShipLivery,
    capacity: number,
  ) {
    const engine = new Color(livery.engine);
    this.anchor = exhaust(model).z + 0.1;
    this.hull = new InstancedMesh(
      hullGeometry(model, livery),
      new MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.38, emissive: '#0b0d12' }),
      capacity,
    );
    this.nozzles = new InstancedMesh(
      nozzleGeometry(model),
      new MeshBasicMaterial({ color: engine.clone().multiplyScalar(1.6) }),
      capacity,
    );
    this.flames = new InstancedMesh(
      flameGeometry(model),
      new MeshBasicMaterial({
        color: engine,
        transparent: true,
        opacity: 0.55,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
      capacity,
    );
    for (const mesh of [this.hull, this.nozzles, this.flames]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
    }
  }

  get objects() {
    return [this.hull, this.nozzles, this.flames];
  }

  set count(n: number) {
    this.hull.count = n;
    this.nozzles.count = n;
    this.flames.count = n;
  }

  /** Posiciona a nave `i`. `throttle` (0 a 1+) estica a chama; `flicker` dá o tremor do fogo. */
  setShip(i: number, matrix: Matrix4, throttle: number, flicker: number): void {
    this.hull.setMatrixAt(i, matrix);
    this.nozzles.setMatrixAt(i, matrix);
    const len = Math.max(0.05, throttle * (0.85 + 0.3 * flicker));
    // Estica a chama só para trás: escala em Z ancorada no bocal (as chamas já começam no bocal).
    const w = 1 + 0.15 * flicker;
    const a = this.anchor;
    // T(a) · S · T(-a): a chama cresce a partir do bocal, para trás.
    this.flameMatrix.set(w, 0, 0, 0, 0, w, 0, 0, 0, 0, len, a - len * a, 0, 0, 0, 1);
    this.flames.setMatrixAt(i, this.tmp.multiplyMatrices(matrix, this.flameMatrix));
  }

  touch(): void {
    this.hull.instanceMatrix.needsUpdate = true;
    this.nozzles.instanceMatrix.needsUpdate = true;
    this.flames.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const mesh of this.objects) {
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
    }
  }
}
