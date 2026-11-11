import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  LineBasicMaterial,
  LineSegments,
  Points,
  ShaderMaterial,
  Vector3,
  type Object3D,
} from 'three';
import type { Animator } from './ambient';
import type { GalaxyLayout } from './layout';
import type { GalaxyProfile } from './quality';

/**
 * Efeitos do movimento ambiente da galáxia (Galáxia Viva). Cada efeito é um objeto da cena mais uma animação que o
 * relógio ambiente avança; nada aqui lê disco nem fala com o Claude, só usa o layout e o grafo já carregados.
 */

export interface Effect {
  objects: Object3D[];
  animator: Animator;
  /** Efeitos que sobrevivem à cena ser refeita (ex.: as naves) recebem o layout novo por aqui. */
  setLayout?: (layout: GalaxyLayout) => void;
}

/** Sorteio com semente (mesma sequência a cada abertura). */
export function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Pontos de luz macios (o mesmo desenho dos halos), com posição, cor, tamanho e transparência por ponto. */
export function haloBuffer(count: number, material: ShaderMaterial) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const alphas = new Float32Array(count);
  const geometry = new BufferGeometry();
  const position = new BufferAttribute(positions, 3);
  const alpha = new BufferAttribute(alphas, 1);
  const size = new BufferAttribute(sizes, 1);
  const color = new BufferAttribute(colors, 3);
  geometry.setAttribute('position', position);
  geometry.setAttribute('color', color);
  geometry.setAttribute('size', size);
  geometry.setAttribute('alpha', alpha);
  const points = new Points(geometry, material);
  return {
    points,
    positions,
    alphas,
    sizes,
    set(i: number, p: { x: number; y: number; z: number }, color: Color, s: number, a: number) {
      positions.set([p.x, p.y, p.z], i * 3);
      colors.set([color.r, color.g, color.b], i * 3);
      sizes[i] = s;
      alphas[i] = a;
    },
    /** Avisa a placa de vídeo do que mudou (chamar depois de alterar posições, tamanhos ou transparências). */
    touch() {
      position.needsUpdate = true;
      alpha.needsUpdate = true;
      size.needsUpdate = true;
      color.needsUpdate = true;
    },
  };
}

const NEBULA_VERTEX = /* glsl */ `
  attribute float size;
  attribute float alpha;
  attribute vec3 color;
  varying float vAlpha;
  varying vec3 vColor;
  uniform float scale;
  uniform float uTime;
  void main() {
    // Deriva lenta: cada grão de poeira oscila no lugar, com fase vinda da própria posição.
    float ph = position.x * 0.071 + position.z * 0.053;
    vec3 p = position + vec3(sin(uTime * 0.11 + ph), sin(uTime * 0.07 + ph * 1.3) * 0.3, cos(uTime * 0.09 + ph)) * 1.6;
    vAlpha = alpha * (0.8 + 0.2 * sin(uTime * 0.4 + ph * 3.0));
    vColor = color;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = size * scale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;
const SOFT_FRAGMENT = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = pow(max(0.0, 1.0 - d), 2.2) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

/** Material da poeira das nebulosas: o mesmo halo, com deriva e cintilar lentos. */
export function createNebulaMaterial(scale: { value: number }, time: { value: number }): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: NEBULA_VERTEX,
    fragmentShader: SOFT_FRAGMENT,
    uniforms: { scale, uTime: time },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

/** Avança o tempo dos shaders (rotação dos planetas, deriva da nebulosa). Movimento lento. */
export function shaderClock(time: { value: number }): Animator {
  return {
    update(dt) {
      time.value += dt;
      return true;
    },
  };
}

const SHOOTING_MAX = 3;
const SHOOTING_LIFE_S = 0.9;
const SHOOTING_RADIUS = 1700;
const SHOOTING_SPEED = 900;
const SHOOTING_LENGTH = 170;

interface Streak {
  start: Vector3;
  dir: Vector3;
  t: number;
}

/**
 * Estrelas cadentes no céu do fundo, de tempos em tempos (o intervalo vem do perfil). Enquanto uma passa, o movimento
 * é rápido; no resto do tempo não pesa nada.
 */
export function createShootingStars(profile: () => GalaxyProfile, rand: () => number): Effect {
  const positions = new Float32Array(SHOOTING_MAX * 6);
  const colors = new Float32Array(SHOOTING_MAX * 6);
  const geometry = new BufferGeometry();
  const position = new BufferAttribute(positions, 3);
  const color = new BufferAttribute(colors, 3);
  geometry.setAttribute('position', position);
  geometry.setAttribute('color', color);
  const lines = new LineSegments(
    geometry,
    new LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
    }),
  );
  lines.frustumCulled = false;
  const streaks: Streak[] = [];
  let wait = profile().shootingStarEverySec * (0.3 + rand());
  const head = new Vector3();
  const tail = new Vector3();

  const animator: Animator = {
    get fast() {
      return streaks.length > 0;
    },
    update(dt) {
      wait -= dt;
      if (wait <= 0) {
        wait = profile().shootingStarEverySec * (0.5 + rand());
        if (streaks.length < SHOOTING_MAX) {
          // Começa num ponto do céu (mais para cima do horizonte) e corre tangente à esfera do fundo.
          const u = 0.15 + rand() * 0.8;
          const phi = rand() * Math.PI * 2;
          const s = Math.sqrt(1 - u * u);
          const start = new Vector3(s * Math.cos(phi), u, s * Math.sin(phi)).multiplyScalar(SHOOTING_RADIUS);
          const dir = new Vector3(rand() - 0.5, -0.4 - rand() * 0.4, rand() - 0.5)
            .projectOnPlane(start.clone().normalize())
            .normalize();
          streaks.push({ start, dir, t: 0 });
        }
      }
      for (let i = streaks.length - 1; i >= 0; i--) {
        streaks[i]!.t += dt;
        if (streaks[i]!.t > SHOOTING_LIFE_S) streaks.splice(i, 1);
      }
      for (let k = 0; k < SHOOTING_MAX; k++) {
        const st = streaks[k];
        if (!st) {
          colors.fill(0, k * 6, k * 6 + 6);
          continue;
        }
        const life = st.t / SHOOTING_LIFE_S;
        const fade = Math.sin(Math.PI * life);
        head
          .copy(st.dir)
          .multiplyScalar(SHOOTING_SPEED * st.t)
          .add(st.start);
        tail
          .copy(st.dir)
          .multiplyScalar(-SHOOTING_LENGTH * Math.min(1, life * 3))
          .add(head);
        positions.set([head.x, head.y, head.z, tail.x, tail.y, tail.z], k * 6);
        colors.set([0.95 * fade, 0.97 * fade, fade, 0, 0, 0], k * 6);
      }
      position.needsUpdate = true;
      color.needsUpdate = true;
      return true;
    },
  };
  return { objects: [lines], animator };
}
