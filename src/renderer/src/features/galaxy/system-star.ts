import { ShaderMaterial } from 'three';

/**
 * Estrela de cada sistema nos modos Alta e Ultra: superfície granulada que se mexe devagar, borda mais escura
 * (escurecimento de limbo) e um anel claro fino no contorno. A cor vem de `instanceColor` (a cor do sistema).
 * O miolo fica abaixo do limiar do bloom, para a estrela não virar uma bola branca chapada.
 */
const VERTEX = /* glsl */ `
  varying vec3 vObj;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vC;
  void main() {
    vObj = position;
    #ifdef USE_INSTANCING_COLOR
      vC = instanceColor;
    #else
      vC = vec3(1.0);
    #endif
    vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelViewMatrix) * mat3(instanceMatrix) * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uTime;
  varying vec3 vObj;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vC;
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
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  void main() {
    vec3 p = normalize(vObj);
    float t = uTime * 0.15;
    float g = 0.55 * vnoise(p * 5.0 + vec3(t, 0.0, -t)) + 0.3 * vnoise(p * 11.0 - vec3(0.0, t, t)) + 0.15 * vnoise(p * 23.0);
    float mu = max(dot(normalize(vN), normalize(vV)), 0.0);
    float limb = 0.45 + 0.55 * pow(mu, 0.6);
    vec3 hot = mix(vC, vec3(1.0, 0.97, 0.9), 0.18);
    vec3 col = hot * (0.55 + 0.45 * g) * limb * 0.9;
    col += vC * pow(1.0 - mu, 3.0) * 0.6;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export function createSystemStarMaterial(time: { value: number }): ShaderMaterial {
  return new ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms: { uTime: time } });
}
