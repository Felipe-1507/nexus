import { BackSide, Mesh, ShaderMaterial, SphereGeometry, type PerspectiveCamera } from 'three';

/**
 * Fundo profundo dos modos Alta e Ultra: uma esfera enorme em volta de tudo, com nebulosas em camadas (ruído em três
 * escalas) e faixas de poeira escura que recortam a luz. É bem fraca e quase toda preta, para o fundo continuar escuro;
 * como fica "no infinito", não acompanha a câmera ao girar e dá profundidade em relação aos planetas.
 * `detail`: 1 = Alta (duas camadas), 2 = Ultra (três camadas e mais contraste).
 */
const VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = vec4(p.xy, p.w * 0.9999, p.w); // sempre atrás de tudo, sem cair fora do plano de fundo
  }
`;

const FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uDetail;
  varying vec3 vDir;
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
  float fbm(vec3 p) {
    float a = 0.5; float s = 0.0;
    for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.02; a *= 0.5; }
    return s;
  }
  void main() {
    vec3 d = normalize(vDir);
    float t = uTime * 0.004;
    // Faixa da "Via Láctea": mais densa perto de um grande círculo inclinado.
    float band = exp(-pow(dot(d, normalize(vec3(0.25, 1.0, 0.35))) / 0.32, 2.0));
    float n1 = fbm(d * 2.2 + vec3(t, 0.0, 0.0));
    float n2 = fbm(d * 4.5 + 7.0);
    float cloud = smoothstep(0.38, 0.72, n1) * (0.3 + 0.7 * band);
    vec3 col = mix(vec3(0.32, 0.14, 0.52), vec3(0.08, 0.30, 0.55), smoothstep(0.35, 0.65, n2)) * cloud;
    // Segunda camada, quente, só nas partes mais densas.
    col += vec3(0.55, 0.24, 0.08) * smoothstep(0.55, 0.8, n2) * cloud * 0.8;
    if (uDetail > 1.5) {
      float n3 = fbm(d * 9.0 - 3.0);
      col += vec3(0.10, 0.12, 0.22) * smoothstep(0.55, 0.8, n3) * band * 0.6;
    }
    // Poeira escura recortando a luz (dá relevo à nebulosa).
    float dust = smoothstep(0.48, 0.66, fbm(d * 6.0 + 21.0));
    col *= 1.0 - 0.75 * dust * band;
    col *= uDetail > 1.5 ? 1.0 : 0.8;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export function createDeepSky(time: { value: number }, detail: number): Mesh {
  const mesh = new Mesh(
    new SphereGeometry(1, 48, 32),
    new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { uTime: time, uDetail: { value: detail } },
      side: BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    }),
  );
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  // Acompanha a posição da câmera (nunca se chega perto dela), mas não a rotação: o céu fica parado no infinito.
  mesh.onBeforeRender = (_r, _s, camera) => {
    mesh.position.copy(camera.position);
    mesh.scale.setScalar(((camera as PerspectiveCamera).far || 1000) * 0.9);
    mesh.updateMatrixWorld();
  };
  return mesh;
}
