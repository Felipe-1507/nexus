import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  ShaderMaterial,
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
  /** 0 = casco, 1 = detalhe, 2 = escuro (frestas, bocal), 3 = janelas e faixas acesas. */
  tone: 0 | 1 | 2 | 3;
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
type Blueprint = {
  parts: Part[];
  engines: Array<[number, number, number, number]>;
  /** Luzes de navegação: ponta da asa esquerda (vermelha), direita (verde) e cauda (branca, pisca). */
  lights: { port: [number, number, number]; starboard: [number, number, number]; tail: [number, number, number] };
};

function blueprint(model: ShipModel): Blueprint {
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
        lights: { port: [0.58, -0.02, -0.15], starboard: [-0.58, -0.02, -0.15], tail: [0, 0.35, -0.42] },
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
          { geometry: place(new BoxGeometry(0.03, 0.04, 0.32), [0.27, 0.04, 0.1]), tone: 3 },
          { geometry: place(new BoxGeometry(0.03, 0.04, 0.32), [-0.27, 0.04, 0.1]), tone: 3 },
        ],
        engines: [
          [0.42, -0.05, -0.68, 0.09],
          [-0.42, -0.05, -0.68, 0.09],
        ],
        lights: { port: [0.66, -0.05, -0.2], starboard: [-0.66, -0.05, -0.2], tail: [0, 0.12, -0.55] },
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
          { geometry: place(new BoxGeometry(0.43, 0.03, 0.9), [0, 0.04, 0.2]), tone: 3 },
          { geometry: place(new BoxGeometry(0.1, 0.05, 0.06), [0, 0.33, 0.15]), tone: 3 },
        ],
        engines: [
          [0.55, 0, -0.8, 0.11],
          [-0.55, 0, -0.8, 0.11],
          [0, 0, -1.0, 0.14],
        ],
        lights: { port: [0.71, 0, -0.35], starboard: [-0.71, 0, -0.35], tail: [0, 0.2, -0.9] },
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
          { geometry: place(new BoxGeometry(0.42, 0.06, 0.04), [0, 0.12, 1.38]), tone: 3 },
          { geometry: place(new BoxGeometry(0.92, 0.04, 0.47), [0, 0.31, -0.85]), tone: 3 },
        ],
        engines: [
          [0.25, 0.15, -1.22, 0.12],
          [-0.25, 0.15, -1.22, 0.12],
          [0.25, -0.15, -1.22, 0.12],
          [-0.25, -0.15, -1.22, 0.12],
        ],
        lights: { port: [0.46, 0, -0.85], starboard: [-0.46, 0, -0.85], tail: [0, 0.34, -1.05] },
      };
  }
}

/**
 * Casco com cor por vértice: o tom 0 vira a cor do casco, 1 a do detalhe, 2 um cinza escuro e 3 a cor do motor (janelas
 * e faixas acesas, marcadas no atributo `aGlow`).
 */
function hullGeometry(model: ShipModel, livery: ShipLivery): BufferGeometry {
  const tones = [new Color(livery.hull), new Color(livery.trim), new Color('#262a33'), new Color(livery.engine)];
  const geometries = blueprint(model).parts.map(({ geometry, tone }) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    g.deleteAttribute('uv');
    const c = tones[tone]!;
    const count = g.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
    g.setAttribute('color', new Float32BufferAttribute(colors, 3));
    g.setAttribute('aGlow', new Float32BufferAttribute(new Float32Array(count).fill(tone === 3 ? 1 : 0), 1));
    return g;
  });
  return mergeGeometries(geometries)!;
}

/**
 * Material do casco: o padrão do Three.js com três acréscimos feitos no shader, sem imagens:
 * - painéis: linhas finas em grade nas coordenadas do modelo e placas com tom levemente variado;
 * - janelas e faixas (`aGlow`) brilham sozinhas, na cor do motor;
 * - luz quente vindo do buraco negro (o centro da galáxia) e luz de borda azulada, que recorta a silhueta no escuro.
 */
function hullMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.4, emissive: '#07080c' });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        'attribute float aGlow;\nvarying float vGlow;\nvarying vec3 vLocal;\nvarying vec3 vToCore;\nvoid main() {',
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vGlow = aGlow;
        vLocal = position;
        vToCore = (viewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz - mvPosition.xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'varying float vGlow;\nvarying vec3 vLocal;\nvarying vec3 vToCore;\nvoid main() {')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 g = vLocal * vec3(9.0, 11.0, 6.0);
          vec3 f = abs(fract(g) - 0.5);
          float seam = smoothstep(0.46, 0.5, max(f.x, max(f.y, f.z)));
          float plate = fract(sin(dot(floor(g), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          diffuseColor.rgb *= (0.9 + 0.12 * plate) * (1.0 - 0.35 * seam * (1.0 - vGlow));
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += vColor.rgb * vGlow * 1.8;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          vec3 V = normalize(vViewPosition);
          vec3 L = normalize(vToCore);
          float key = max(dot(normal, L), 0.0);
          outgoingLight += diffuseColor.rgb * vec3(1.0, 0.72, 0.42) * key * 0.9 * (1.0 - vGlow);
          float rim = pow(1.0 - max(dot(normal, V), 0.0), 3.0);
          outgoingLight += vec3(0.35, 0.55, 1.0) * rim * 0.55;
        }
        #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => 'nexus-ship-hull';
  return material;
}

/** Chamas: um cone por propulsor, virado para trás. `aT` vai de 0 (bocal) a 1 (ponta da chama). */
function flameGeometry(model: ShipModel): BufferGeometry {
  const parts = blueprint(model).engines.map(([x, y, z, r]) => {
    const g = new ConeGeometry(r, r * 9, 14, 8, true).rotateX(-Math.PI / 2).translate(x, y, z - r * 4.5);
    const pos = g.getAttribute('position');
    const t = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) t[i] = Math.min(1, Math.max(0, (z - pos.getZ(i)) / (r * 9)));
    g.setAttribute('aT', new Float32BufferAttribute(t, 1));
    g.deleteAttribute('uv');
    return g;
  });
  return mergeGeometries(parts)!;
}

const FLAME_VERTEX = /* glsl */ `
  attribute float aT;
  attribute float aThrottle;
  varying float vT;
  varying float vThrottle;
  varying float vFacing;
  varying float vSeed;
  void main() {
    vT = aT;
    vThrottle = aThrottle;
    vSeed = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.11;
    vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    vec3 n = normalize(mat3(modelViewMatrix) * mat3(instanceMatrix) * normal);
    // De frente para a câmera = miolo da chama; de lado = beirada.
    vFacing = abs(dot(n, normalize(-mv.xyz)));
    gl_Position = projectionMatrix * mv;
  }
`;

const FLAME_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  varying float vT;
  varying float vThrottle;
  varying float vFacing;
  varying float vSeed;
  float hash1(float n) { return fract(sin(n) * 43758.5453); }
  float noise1(float x) { float i = floor(x); float f = fract(x); return mix(hash1(i), hash1(i + 1.0), f * f * (3.0 - 2.0 * f)); }
  void main() {
    float t = clamp(vT, 0.0, 1.0);
    // Ruído correndo para trás e diamantes de choque (anéis claros ao longo do jato), mais nítidos acelerando.
    float n = noise1(t * 9.0 - uTime * 14.0 + vSeed * 7.0);
    float diamonds = pow(0.5 + 0.5 * cos(t * 38.0 - uTime * 3.0), 6.0) * smoothstep(0.02, 0.15, t) * (1.0 - t) * vThrottle;
    float core = pow(vFacing, 2.2);
    float fade = pow(1.0 - t, 1.4);
    float a = fade * (0.35 + 0.65 * core) * (0.7 + 0.5 * n) + diamonds * 0.8;
    // Núcleo branco quente perto do bocal; borda e ponta na cor do motor.
    vec3 hot = vec3(1.0, 0.97, 0.9);
    vec3 col = mix(uColor, hot, clamp(core * (1.0 - t * 1.6) + diamonds, 0.0, 1.0));
    gl_FragColor = vec4(col * a * (0.35 + 0.9 * vThrottle), 1.0);
  }
`;

/** Bocais acesos (a parte de dentro do propulsor), sempre visíveis. */
function nozzleGeometry(model: ShipModel): BufferGeometry {
  return mergeGeometries(
    blueprint(model).engines.map(([x, y, z, r]) =>
      new SphereGeometry(r * 0.9, 8, 6).scale(1, 1, 0.4).translate(x, y, z),
    ),
  )!;
}

/** Luzes de navegação: vermelha à esquerda, verde à direita (fixas) e branca na cauda (pisca). `aBlink` marca a branca. */
function navGeometry(model: ShipModel): BufferGeometry {
  const { port, starboard, tail } = blueprint(model).lights;
  const lights: Array<[[number, number, number], string, number]> = [
    [port, '#ff3b30', 0],
    [starboard, '#34ff6a', 0],
    [tail, '#ffffff', 1],
  ];
  return mergeGeometries(
    lights.map(([pos, hex, blink]) => {
      const g = new SphereGeometry(0.035, 6, 4).translate(...pos);
      const c = new Color(hex);
      const n = g.getAttribute('position').count;
      const colors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
      g.setAttribute('color', new Float32BufferAttribute(colors, 3));
      g.setAttribute('aBlink', new Float32BufferAttribute(new Float32Array(n).fill(blink), 1));
      g.deleteAttribute('uv');
      return g;
    }),
  )!;
}

const NAV_VERTEX = /* glsl */ `
  attribute float aBlink;
  uniform float uTime;
  varying vec3 vNav;
  void main() {
    float phase = fract(instanceMatrix[3].x * 0.173 + instanceMatrix[3].z * 0.091);
    // A branca dá uma piscada curta a cada 1,4 s; as outras ficam acesas.
    float on = aBlink > 0.5 ? step(0.86, fract(uTime / 1.4 + phase)) : 1.0;
    vNav = color * (aBlink > 0.5 ? 3.0 : 1.6) * on;
    vec4 mv = modelViewMatrix * instanceMatrix * vec4(position * (0.35 + 0.65 * on), 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const NAV_FRAGMENT = /* glsl */ `
  varying vec3 vNav;
  void main() { gl_FragColor = vec4(vNav, 1.0); }
`;

/** Ponto onde fica o motor principal (para o rastro sair dele), em unidades do modelo. */
export function exhaust(model: ShipModel): Vector3 {
  const e = blueprint(model).engines;
  const z = Math.min(...e.map(([, , ez]) => ez));
  return new Vector3(0, 0, z - 0.1);
}

/** Uma frota de um modelo e uma pintura: casco, bocais, chamas e luzes de navegação, todos instanciados. */
export class Fleet {
  readonly hull: InstancedMesh;
  readonly nozzles: InstancedMesh;
  readonly flames: InstancedMesh;
  readonly lights: InstancedMesh;
  private readonly throttle: InstancedBufferAttribute;
  private readonly time = { value: 0 };
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
    this.hull = new InstancedMesh(hullGeometry(model, livery), hullMaterial(), capacity);
    this.nozzles = new InstancedMesh(
      nozzleGeometry(model),
      new MeshBasicMaterial({ color: engine.clone().multiplyScalar(1.6) }),
      capacity,
    );
    const flame = flameGeometry(model);
    this.throttle = new InstancedBufferAttribute(new Float32Array(capacity), 1);
    flame.setAttribute('aThrottle', this.throttle);
    this.flames = new InstancedMesh(
      flame,
      new ShaderMaterial({
        vertexShader: FLAME_VERTEX,
        fragmentShader: FLAME_FRAGMENT,
        uniforms: { uColor: { value: engine }, uTime: this.time },
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      }),
      capacity,
    );
    this.lights = new InstancedMesh(
      navGeometry(model),
      new ShaderMaterial({
        vertexShader: NAV_VERTEX,
        fragmentShader: NAV_FRAGMENT,
        uniforms: { uTime: this.time },
        vertexColors: true,
      }),
      capacity,
    );
    for (const mesh of this.objects) {
      mesh.count = 0;
      mesh.frustumCulled = false;
    }
  }

  get objects() {
    return [this.hull, this.nozzles, this.flames, this.lights];
  }

  set count(n: number) {
    for (const mesh of this.objects) mesh.count = n;
  }

  /** Posiciona a nave `i`. `throttle` (0 a 1+) estica e acende a chama; `flicker` dá o tremor do fogo. */
  setShip(i: number, matrix: Matrix4, throttle: number, flicker: number): void {
    this.hull.setMatrixAt(i, matrix);
    this.nozzles.setMatrixAt(i, matrix);
    this.lights.setMatrixAt(i, matrix);
    this.throttle.setX(i, throttle);
    const len = Math.max(0.05, throttle * (0.85 + 0.3 * flicker));
    const w = 1 + 0.15 * flicker;
    const a = this.anchor;
    // T(a) · S · T(-a): a chama cresce a partir do bocal, para trás.
    this.flameMatrix.set(w, 0, 0, 0, 0, w, 0, 0, 0, 0, len, a - len * a, 0, 0, 0, 1);
    this.flames.setMatrixAt(i, this.tmp.multiplyMatrices(matrix, this.flameMatrix));
  }

  touch(): void {
    this.time.value = (performance.now() / 1000) % 1000;
    for (const mesh of this.objects) mesh.instanceMatrix.needsUpdate = true;
    this.throttle.needsUpdate = true;
  }

  dispose(): void {
    for (const mesh of this.objects) {
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
    }
  }
}
