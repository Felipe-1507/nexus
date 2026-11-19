import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Euler,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type Object3D,
} from 'three';
import { seeded, haloBuffer } from './effects';
import type { GalaxyProfile } from './quality';

/**
 * Núcleo "Eclipse" (GE4): no lugar do sol, um buraco negro estilizado no centro do Workspace. Não é uma simulação da
 * física: é uma imitação barata do visual, feita com shaders procedurais e poucas chamadas de desenho.
 *
 * - **Sombra:** esfera preta que esconde o que está atrás dela (estrelas, nebulosa, a parte de trás do disco).
 * - **Disco de acreção:** anel inclinado, com turbulência que gira mais rápido por dentro, brilho mais forte no lado que
 *   vem na direção da câmera (efeito Doppler) e cor do amarelo-claro ao laranja escuro.
 * - **Arco da lente:** o disco visto "por trás" do buraco negro aparece como um arco em cima e embaixo da sombra. Em vez
 *   de curvar a luz de verdade, um quad sempre virado para a câmera desenha o arco e o anel de luz que contorna a sombra.
 * - **Poeira:** pontos em órbita que espiralam para dentro, somem perto da sombra e recomeçam lá fora. Tudo calculado
 *   na placa de vídeo a partir do tempo compartilhado (a CPU não mexe em nada por quadro).
 *
 * Posições, rotas e seleção das notas não dependem deste objeto: ele só ocupa o centro, dentro do raio do sol.
 */

/** Cores no espaço da tela (os pontos de luz da galáxia também são escritos assim). */
const HOT = [1.0, 0.88, 0.62] as const;
const WARM = [1.0, 0.64, 0.24] as const;
const DEEP = [0.95, 0.24, 0.05] as const;

/** Inclinação do disco em relação ao plano da galáxia (radianos): oblíquo, para a profundidade aparecer. */
const TILT = new Euler(-Math.PI / 2 + 0.52, 0, -0.32);
/** Normal do disco no mundo (o disco é um anel no plano XY local, com normal +Z). */
const DISK_NORMAL = new Vector3(0, 0, 1).applyEuler(TILT);

/** Proporções, em raios da sombra (R0). */
const DISK_INNER = 1.35;
const DISK_OUTER = 3.1;
const DUST_OUTER = 3.6;

const DISK_VERTEX = /* glsl */ `
  varying vec2 vPos;
  varying vec3 vWorld;
  varying vec3 vTangent;
  void main() {
    vPos = position.xy;
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    // Sentido em que a matéria gira neste ponto do disco (já no mundo), para o efeito Doppler.
    vTangent = normalize(mat3(modelMatrix) * vec3(-position.y, position.x, 0.0));
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
  }
`;

const NOISE = /* glsl */ `
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vnoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i + vec3(0, 0, 0)), hash(i + vec3(1, 0, 0)), f.x),
          mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
          mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
`;

const DISK_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vPos;
  varying vec3 vWorld;
  varying vec3 vTangent;
  uniform float uTime;
  uniform float uR0;
  uniform float uOctaves;
  uniform vec3 uHot;
  uniform vec3 uWarm;
  uniform vec3 uDeep;
  uniform vec3 uTint;
  ${NOISE}
  const float INNER = ${DISK_INNER.toFixed(2)};
  const float OUTER = ${DISK_OUTER.toFixed(2)};
  const float PERIOD = 36.0;

  // Turbulência em coordenadas do disco. 'shear' é o tempo de enrolamento: o miolo gira mais rápido que a borda.
  float turbulence(float r, float phi, float shear) {
    float ang = phi + shear * 0.62 * pow(r, -1.5);
    vec3 q = vec3(cos(ang), sin(ang), 0.0) * 1.9 + vec3(0.0, 0.0, r * 6.5);
    float n = 0.58 * vnoise(q) + 0.28 * vnoise(q * 2.1 + 7.3);
    if (uOctaves > 2.5) n += 0.16 * vnoise(q * 4.3 + 3.1); else n += 0.08;
    return n;
  }

  void main() {
    float r = length(vPos) / uR0;
    float phi = atan(vPos.y, vPos.x);
    float body = smoothstep(INNER, INNER + 0.18, r) * (1.0 - smoothstep(OUTER - 0.95, OUTER, r));
    if (body < 0.003) discard;

    // Duas amostras de turbulência defasadas, que se alternam: o padrão nunca se enrola demais com o passar das horas.
    float a = fract(uTime / PERIOD);
    float b = fract(uTime / PERIOD + 0.5);
    float wa = 1.0 - abs(2.0 * a - 1.0);
    float n = wa * turbulence(r, phi, a * PERIOD) + (1.0 - wa) * turbulence(r, phi, b * PERIOD);

    // Quanto mais perto da sombra, mais quente.
    float heat = clamp(1.0 - (r - INNER) / (OUTER - INNER), 0.0, 1.0);
    vec3 col = mix(uDeep, uWarm, smoothstep(0.0, 0.6, heat));
    col = mix(col, uHot, smoothstep(0.55, 1.0, heat + (n - 0.5) * 0.5));
    col *= mix(vec3(1.0), uTint, 0.1);

    // Efeito Doppler: o lado que se move na direção da câmera brilha mais, o que se afasta, menos.
    vec3 tangent = normalize(vTangent);
    vec3 toCam = normalize(cameraPosition - vWorld);
    float beta = 0.5 * inversesqrt(r / INNER);
    float doppler = clamp(1.0 / (1.0 - beta * dot(tangent, toCam)), 0.6, 1.7);

    float intensity = body * (0.3 + 1.0 * pow(heat, 1.5)) * (0.25 + 1.3 * n * n + 0.3 * n) * pow(doppler, 2.3);
    // Compressão de brilho (1 - e^-x): o miolo chega perto do branco, mas a borda continua laranja e a turbulência aparece.
    gl_FragColor = vec4(1.0 - exp(-col * intensity * 0.8), 1.0);
  }
`;

const ARC_VERTEX = /* glsl */ `
  uniform float uSize;
  varying vec2 vUv;
  void main() {
    vUv = position.xy;
    vec4 center = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    gl_Position = projectionMatrix * (center + vec4(position.xy * uSize, 0.0, 0.0));
  }
`;

const ARC_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uZoom;
  uniform vec3 uNormal;
  uniform vec3 uHot;
  uniform vec3 uWarm;
  uniform vec3 uDeep;
  uniform vec3 uTint;
  void main() {
    // Distância ao centro em raios da sombra (o quad cobre 'uZoom' raios de cada lado).
    float rr = length(vUv) * uZoom;
    if (rr < 1.0 || rr > uZoom) discard;
    vec2 dir = vUv / max(length(vUv), 1e-5);

    // Para onde o "alto" do disco aponta na tela, e o quanto o disco está de lado (de lado, o arco aparece mais).
    vec3 nv = normalize(mat3(viewMatrix) * uNormal);
    float edge = 1.0 - abs(nv.z);
    vec2 up = nv.xy / max(length(nv.xy), 1e-4);
    float c = dot(dir, up);
    float side = dot(dir, vec2(-up.y, up.x));

    // O disco de trás, "dobrado" por cima e por baixo da sombra: mais forte em cima, mais fraco embaixo.
    float hug = exp(-(rr - 1.04) * 2.4);
    float lobe = 0.1 + 1.0 * pow(abs(c), 2.2);
    float arc = hug * lobe * (0.3 + 0.7 * edge) * (c > 0.0 ? 1.0 : 0.6) * (1.0 + 0.4 * side);

    // O anel fino de luz que contorna a sombra, e um halo suave por fora dele.
    float ring = exp(-pow((rr - 1.04) / 0.018, 2.0));
    float halo = 0.12 * exp(-pow((rr - 1.14) / 0.2, 2.0));

    float heat = clamp(hug, 0.0, 1.0);
    vec3 col = mix(uWarm, uHot, smoothstep(0.35, 1.0, heat));
    col = mix(uDeep, col, 0.45 + 0.55 * heat);
    col *= mix(vec3(1.0), uTint, 0.1);
    float fade = 1.0 - smoothstep(uZoom * 0.7, uZoom, rr);
    gl_FragColor = vec4(1.0 - exp(-col * (arc * 1.4 + ring * 1.1 + halo) * fade), 1.0);
  }
`;

const DUST_VERTEX = /* glsl */ `
  attribute vec4 aSeed;
  attribute float aSize;
  uniform float uTime;
  uniform float uR0;
  uniform float uScale;
  varying float vAlpha;
  varying float vHeat;
  void main() {
    // Cada grão cumpre um ciclo: nasce longe, espirala para dentro e some perto da sombra.
    float period = 48.0 + 46.0 * aSeed.z;
    float cyc = fract(uTime / period + aSeed.x);
    float r = mix(uR0 * ${DUST_OUTER.toFixed(2)}, uR0 * 1.12, pow(cyc, 1.35));
    float turns = 0.5 + 2.8 * (cyc + 1.8 * cyc * cyc * cyc);
    float ang = aSeed.y * 6.2831853 + turns * 6.2831853;
    float h = aSeed.w * uR0 * (0.04 + 0.42 * (r / (uR0 * ${DUST_OUTER.toFixed(2)}))) * (1.0 - 0.5 * cyc);
    vec3 p = vec3(cos(ang) * r, sin(ang) * r, h);
    vHeat = pow(cyc, 1.6);
    vAlpha = smoothstep(0.0, 0.1, cyc) * (1.0 - smoothstep(0.86, 1.0, cyc)) * (0.28 + 0.72 * vHeat);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = aSize * uScale / -mv.z * (0.75 + 0.8 * vHeat);
    gl_Position = projectionMatrix * mv;
  }
`;

const DUST_FRAGMENT = /* glsl */ `
  precision highp float;
  varying float vAlpha;
  varying float vHeat;
  uniform vec3 uHot;
  uniform vec3 uWarm;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = pow(max(0.0, 1.0 - d), 1.8) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(mix(uWarm, uHot, vHeat), a);
  }
`;

/** Cor do Workspace puxada para o branco, para tingir de leve o disco (a identidade do Workspace continua visível). */
function tint(workspaceHex: string): Color {
  return new Color(workspaceHex).lerp(new Color('#ffffff'), 0.25);
}

/** Quanto do Eclipse o modo escolhido desenha. */
export interface EclipseQuality {
  /** Grãos de poeira em órbita. */
  dust: number;
  /** Camadas de ruído do disco (2 ou 3). */
  octaves: number;
  /** Segmentos do anel do disco. */
  segments: number;
  /** Camadas de brilho em volta (1 a 3). */
  glowLayers: number;
}

export function eclipseQuality(profile: Pick<GalaxyProfile, 'eclipse' | 'sunLayers'>): EclipseQuality {
  return { ...profile.eclipse, glowLayers: profile.sunLayers };
}

/**
 * Objetos do Eclipse, todos soltos (a cena libera cada um ao ser refeita). `radius`: o raio do sol (o Eclipse cabe
 * dentro dele). `scale`: o tamanho em pixels dos pontos de luz, compartilhado com os halos da cena.
 */
export function createEclipse(options: {
  radius: number;
  color: string;
  time: { value: number };
  scale: { value: number };
  halo: ShaderMaterial;
  quality: EclipseQuality;
}): Object3D[] {
  const { radius, time, scale, halo, quality } = options;
  const r0 = radius * 0.34;
  const tinted = tint(options.color);
  const colors = {
    uHot: { value: new Color().fromArray(HOT) },
    uWarm: { value: new Color().fromArray(WARM) },
    uDeep: { value: new Color().fromArray(DEEP) },
    uTint: { value: tinted },
  };

  // Sombra: preta e opaca, esconde o que passa atrás dela.
  const shadow = new Mesh(new SphereGeometry(r0, 40, 28), new MeshBasicMaterial({ color: 0x000000 }));

  // Disco de acreção inclinado.
  const disk = new Mesh(
    new RingGeometry(r0 * (DISK_INNER - 0.1), r0 * (DISK_OUTER + 0.05), quality.segments, 1),
    new ShaderMaterial({
      vertexShader: DISK_VERTEX,
      fragmentShader: DISK_FRAGMENT,
      uniforms: { uTime: time, uR0: { value: r0 }, uOctaves: { value: quality.octaves }, ...colors },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    }),
  );
  disk.rotation.copy(TILT);

  // Arco da lente e anel de luz: um quad sempre virado para a câmera, desenhado por cima.
  const zoom = 2.6;
  const arc = new Mesh(
    new PlaneGeometry(2, 2),
    new ShaderMaterial({
      vertexShader: ARC_VERTEX,
      fragmentShader: ARC_FRAGMENT,
      uniforms: { uSize: { value: r0 * zoom }, uZoom: { value: zoom }, uNormal: { value: DISK_NORMAL }, ...colors },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: AdditiveBlending,
    }),
  );
  arc.renderOrder = 10;
  arc.frustumCulled = false;

  // Poeira em órbita: tudo na placa de vídeo, sorteios fixos (a mesma poeira a cada abertura).
  const dust = createDust(r0, quality.dust, time, scale, colors);
  dust.rotation.copy(TILT);

  // Brilho em volta: pontos macios no centro (a sombra, opaca, cobre o miolo).
  const glow = haloBuffer(quality.glowLayers, halo);
  const sizes = [radius * 5.5, radius * 11, radius * 21];
  const alphas = [0.3, 0.12, 0.05];
  const glowColor = new Color().fromArray(WARM).lerp(tinted, 0.3);
  for (let i = 0; i < quality.glowLayers; i++) glow.set(i, { x: 0, y: 0, z: 0 }, glowColor, sizes[i]!, alphas[i]!);
  glow.points.frustumCulled = false;

  return [shadow, disk, dust, arc, glow.points];
}

function createDust(
  r0: number,
  count: number,
  time: { value: number },
  scale: { value: number },
  colors: { uHot: { value: Color }; uWarm: { value: Color } },
): Points {
  const rand = seeded(1703);
  const seeds = new Float32Array(count * 4);
  const sizes = new Float32Array(count);
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Soma de dois sorteios: concentra os grãos perto do plano do disco, com algumas caudas.
    seeds.set([rand(), rand(), rand(), rand() + rand() - 1], i * 4);
    sizes[i] = 0.12 + 0.4 * rand() * rand();
  }
  const geometry = new BufferGeometry();
  // A posição de verdade sai do shader; este atributo só dá a contagem de vértices.
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new BufferAttribute(seeds, 4));
  geometry.setAttribute('aSize', new BufferAttribute(sizes, 1));
  const points = new Points(
    geometry,
    new ShaderMaterial({
      vertexShader: DUST_VERTEX,
      fragmentShader: DUST_FRAGMENT,
      uniforms: { uTime: time, uR0: { value: r0 }, uScale: scale, uHot: colors.uHot, uWarm: colors.uWarm },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    }),
  );
  points.frustumCulled = false;
  return points;
}
