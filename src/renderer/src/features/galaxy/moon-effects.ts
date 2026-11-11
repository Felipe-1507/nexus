import {
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import type { GalaxyGraph } from '@shared/knowledge';
import { hash01 } from '@shared/planets';
import type { GalaxyLayout } from './layout';
import type { GalaxyProfile } from './quality';

/**
 * Luas de anexos (Galáxia Viva, G7): cada arquivo incorporado numa nota (`![[contrato.pdf]]`, imagens) vira uma lua
 * pequena em volta do planeta, com a cor pelo tipo de arquivo. A órbita é calculada no shader a partir do tempo
 * compartilhado: girar as luas não custa nada à CPU. Os nomes vêm do índice, sem ler disco a mais.
 */

export type MoonKind = 'imagem' | 'documento' | 'planilha' | 'midia' | 'outro';

export const MOON_COLORS: Record<MoonKind, string> = {
  imagem: '#bcd8ff',
  documento: '#ffc993',
  planilha: '#a8ecbe',
  midia: '#d6b8ff',
  outro: '#cfd2dc',
};

export const MOON_LABELS: Record<MoonKind, string> = {
  imagem: 'Imagem',
  documento: 'Documento',
  planilha: 'Planilha',
  midia: 'Áudio ou vídeo',
  outro: 'Arquivo',
};

export function moonKind(name: string): MoonKind {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';
  if (/^(png|jpe?g|gif|webp|svg|bmp|avif|heic|tiff?)$/.test(ext)) return 'imagem';
  if (/^(pdf|docx?|odt|rtf|txt|pptx?|odp|epub)$/.test(ext)) return 'documento';
  if (/^(xlsx?|xlsm|ods|csv|tsv)$/.test(ext)) return 'planilha';
  if (/^(mp3|m4a|wav|ogg|flac|aac|mp4|mov|mkv|webm|avi)$/.test(ext)) return 'midia';
  return 'outro';
}

/** Nome do arquivo, sem as pastas. */
export const moonName = (name: string) => name.slice(name.replace(/\\/g, '/').lastIndexOf('/') + 1);

export interface MoonPlan {
  /** Índice da nota (planeta). */
  note: number;
  /** Como está escrito na nota (é o que o main procura no vault). */
  name: string;
  kind: MoonKind;
  radius: number;
  phase: number;
  /** Radianos por segundo (negativo = sentido contrário). */
  speed: number;
  /** Inclinação da órbita em relação ao plano da galáxia. */
  tilt: number;
  size: number;
}

/**
 * Luas de cada planeta, até os limites do perfil. As primeiras luas de todos os planetas vêm antes das segundas, para
 * o limite total não deixar uns planetas com muitas e outros sem nenhuma. Órbitas dentro do espaço livre do planeta.
 */
export function planMoons(graph: GalaxyGraph, layout: GalaxyLayout, profile: GalaxyProfile): MoonPlan[] {
  const { moonsPerPlanet, moons: total } = profile.limits;
  const out: MoonPlan[] = [];
  for (let k = 0; k < moonsPerPlanet; k++) {
    for (let i = 0; i < graph.notes.length && out.length < total; i++) {
      const name = graph.notes[i]!.moons?.[k];
      const p = layout.notes[i];
      if (!name || !p) continue;
      const key = `moon:${graph.notes[i]!.path}:${name}`;
      out.push({
        note: i,
        name,
        kind: moonKind(name),
        radius: p.size * (1.35 + 0.16 * k),
        phase: hash01(key) * Math.PI * 2,
        speed: ((0.35 + 0.4 * hash01(`${key}:v`)) / Math.sqrt(1 + k)) * (hash01(`${key}:d`) < 0.25 ? -1 : 1),
        tilt: (hash01(`${key}:t`) - 0.5) * 0.9,
        size: Math.max(0.08, p.size * (0.1 + 0.05 * hash01(`${key}:s`))),
      });
    }
  }
  return out;
}

/** Posição da lua no tempo `t` (a mesma conta do shader: serve para apontar e clicar nela). */
export function moonPosition(out: Vector3, plan: MoonPlan, center: { x: number; y: number; z: number }, t: number) {
  const a = plan.phase + t * plan.speed;
  const x = Math.cos(a) * plan.radius;
  const z = Math.sin(a) * plan.radius;
  return out.set(center.x + x, center.y + z * Math.sin(plan.tilt), center.z + z * Math.cos(plan.tilt));
}

const MOON_VERTEX = /* glsl */ `
  attribute vec3 aCenter;
  attribute vec4 aOrbit; // x: raio, y: fase, z: velocidade, w: inclinação
  attribute vec4 aLook;  // rgb: cor, a: tamanho
  attribute float aDim;  // 1 = planeta fora da busca
  uniform float uTime;
  varying float vDim;
  varying vec3 vN;
  varying vec3 vObj;
  varying vec3 vC;
  void main() {
    float a = aOrbit.y + uTime * aOrbit.z;
    float x = cos(a) * aOrbit.x;
    float z = sin(a) * aOrbit.x;
    vec3 center = aCenter + vec3(x, z * sin(aOrbit.w), z * cos(aOrbit.w));
    vObj = position;
    vC = aLook.rgb;
    vDim = aDim;
    vN = normalize(mat3(modelViewMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(center + position * aLook.a, 1.0);
  }
`;

const MOON_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec3 vN;
  varying vec3 vObj;
  varying vec3 vC;
  varying float vDim;
  uniform float uRim;
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  void main() {
    // Superfície de lua: manchas suaves (crateras) sobre a cor do tipo de arquivo.
    vec3 q = floor(normalize(vObj) * 4.0);
    float spot = hash(q);
    vec3 col = vC * (0.78 + 0.28 * spot);
    vec3 L = normalize(vec3(0.45, 0.55, 0.7));
    vec3 N = normalize(vN);
    float diff = max(dot(N, L), 0.0);
    float rim = pow(1.0 - abs(N.z), 2.2);
    vec3 outc = col * (0.32 + 0.9 * diff) + vC * rim * (0.25 + 0.35 * uRim);
    outc *= 1.0 - 0.85 * vDim;
    gl_FragColor = vec4(outc, 1.0);
    #include <colorspace_fragment>
  }
`;

/** Malha com todas as luas (uma chamada de desenho). `time` é o mesmo relógio da rotação dos planetas. */
export function createMoons(
  plans: MoonPlan[],
  layout: GalaxyLayout,
  time: { value: number },
  rim: { value: number },
): InstancedMesh | null {
  if (plans.length === 0) return null;
  const geometry = new SphereGeometry(1, 12, 8);
  const centers = new Float32Array(plans.length * 3);
  const orbits = new Float32Array(plans.length * 4);
  const looks = new Float32Array(plans.length * 4);
  const c = new Color();
  plans.forEach((m, i) => {
    const p = layout.notes[m.note]!;
    centers.set([p.x, p.y, p.z], i * 3);
    orbits.set([m.radius, m.phase, m.speed, m.tilt], i * 4);
    c.set(MOON_COLORS[m.kind]);
    looks.set([c.r, c.g, c.b, m.size], i * 4);
  });
  geometry.setAttribute('aCenter', new InstancedBufferAttribute(centers, 3));
  geometry.setAttribute('aOrbit', new InstancedBufferAttribute(orbits, 4));
  geometry.setAttribute('aLook', new InstancedBufferAttribute(looks, 4));
  geometry.setAttribute('aDim', new InstancedBufferAttribute(new Float32Array(plans.length), 1));
  const material = new ShaderMaterial({
    vertexShader: MOON_VERTEX,
    fragmentShader: MOON_FRAGMENT,
    uniforms: { uTime: time, uRim: rim },
  });
  const mesh = new InstancedMesh(geometry, material, plans.length);
  // A posição sai do shader: a caixa de recorte da malha não vale, então ela é sempre desenhada.
  mesh.frustumCulled = false;
  const identity = new Matrix4();
  for (let i = 0; i < plans.length; i++) mesh.setMatrixAt(i, identity);
  return mesh;
}
