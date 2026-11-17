import { Color, Mesh, ShaderMaterial, SphereGeometry, type Object3D } from 'three';
import { haloBuffer } from './effects';

/**
 * O sol do Workspace, no centro da galáxia: uma esfera com a cor do Workspace e a superfície em ebulição, e uma corona
 * de luz em volta. Não tem ligação com nenhuma nota (nada de rotas): só marca de quem é a galáxia e ilumina os
 * planetas (ver `planet-material.ts`). Tudo vem do perfil e do relógio compartilhado; nada é lido do disco.
 */

const SUN_VERTEX = /* glsl */ `
  varying vec3 vObj;
  varying vec3 vN;
  void main() {
    vObj = position;
    vN = normalize(mat3(modelViewMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SUN_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec3 vObj;
  varying vec3 vN;
  uniform vec3 uColor;
  uniform float uTime;
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
  void main() {
    vec3 p = normalize(vObj);
    // Granulação que se desfaz devagar: duas camadas de ruído andando em sentidos diferentes.
    float n = 0.65 * vnoise(p * 2.4 + vec3(0.0, uTime * 0.04, 0.0)) + 0.35 * vnoise(p * 5.5 - vec3(uTime * 0.06, 0.0, 0.0));
    // A cor do Workspace domina; só as manchas mais quentes clareiam em direção ao branco quente.
    vec3 hot = mix(uColor, vec3(1.0, 0.96, 0.88), 0.5);
    vec3 col = mix(uColor * 1.05, hot, smoothstep(0.3, 0.75, n));
    // Escurecimento de limbo suave: a borda puxa para a cor do Workspace, o miolo fica incandescente.
    float facing = clamp(dot(normalize(vN), vec3(0.0, 0.0, 1.0)), 0.0, 1.0);
    col = mix(uColor * 0.9, col, 0.45 + 0.55 * pow(facing, 0.7));
    gl_FragColor = vec4(col * 1.15, 1.0);
    #include <colorspace_fragment>
  }
`;

/** Cor do sol e da luz em volta: a cor do Workspace, puxada para o branco quente para parecer uma estrela. */
export function sunColors(workspaceHex: string): { body: Color; glow: Color } {
  const body = new Color(workspaceHex);
  const glow = body.clone().lerp(new Color('#ffe9c4'), 0.35);
  return { body, glow };
}

/**
 * Objetos do sol. `layers`: camadas de luz da corona (o modo Leve usa menos). `halo`: o material de pontos de luz
 * compartilhado da cena.
 */
export function createSun(options: {
  radius: number;
  color: string;
  time: { value: number };
  halo: ShaderMaterial;
  layers: number;
}): Object3D[] {
  const { radius, time, halo, layers } = options;
  const { body, glow } = sunColors(options.color);
  const mesh = new Mesh(
    new SphereGeometry(radius, 48, 32),
    new ShaderMaterial({
      vertexShader: SUN_VERTEX,
      fragmentShader: SUN_FRAGMENT,
      uniforms: { uColor: { value: body }, uTime: time },
    }),
  );
  // Corona: pontos de luz macios, do mais perto e forte ao mais largo e fraco, todos no centro.
  const corona = haloBuffer(layers, halo);
  const sizes = [radius * 8, radius * 18, radius * 34];
  const alphas = [1, 0.42, 0.16];
  for (let i = 0; i < layers; i++) corona.set(i, { x: 0, y: 0, z: 0 }, glow, sizes[i]!, alphas[i]!);
  corona.points.frustumCulled = false;
  return [mesh, corona.points];
}
