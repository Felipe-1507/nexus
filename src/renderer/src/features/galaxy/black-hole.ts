import {
  CustomBlending,
  Matrix3,
  Matrix4,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  type Color,
  type Euler,
} from 'three';

/**
 * Buraco negro com fótons de verdade (modos Alta e Ultra). Um quad virado para a câmera cobre a região do buraco; para
 * cada pixel, um raio sai da câmera e é dobrado passo a passo pela gravidade (Schwarzschild simplificado:
 * a = -1,5·h²·r/|r|⁵, em raios de Schwarzschild). Quando o raio cruza o plano do disco, soma a luz dele; quando cai no
 * horizonte, o pixel fica preto. Daí saem, sem truque: a sombra, o disco de trás aparecendo por cima e por baixo dela
 * e o anel de fótons fino (raios que dão quase uma volta antes de escapar).
 *
 * O fundo (estrelas, nebulosa) continua sendo curvado pela lente do pós-processamento; este shader só desenha a luz do
 * disco e a sombra, então o disco não é desenhado duas vezes.
 */

/** Sombra aparente = raio crítico 3√3/2 rs ≈ 2,6 rs. Ela casa com o raio da sombra antiga (r0). */
const SHADOW_RS = 2.598;
/** Disco, em raios de Schwarzschild: começa na última órbita estável (3 rs) e vai até ~8 rs. */
const DISK_IN = 3.0;
const DISK_OUT = 8.2;
/** Esfera que contém tudo o que o shader desenha (rs). Fora dela o raio já é praticamente reto. */
const BOUND = 10.5;

const VERTEX = /* glsl */ `
  uniform float uBound;
  varying vec3 vView;
  void main() {
    vec4 center = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float bound = uBound * length(modelViewMatrix[0].xyz);
    float d = max(length(center.xyz), bound * 1.05);
    // O quad fica à frente do centro (a sombra opaca não o cobre) e grande o bastante para cobrir a esfera toda.
    float lift = bound * 0.55;
    vec3 c = center.xyz * (d - lift) / d;
    float size = bound * (d - lift) / sqrt(max(d * d - bound * bound, 1e-3)) * 1.04;
    vec4 view = vec4(c + vec3(position.xy * size, 0.0), 1.0);
    vView = view.xyz;
    gl_Position = projectionMatrix * view;
  }
`;

const FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec3 vView;
  uniform mat3 uToLocal;
  uniform vec3 uCam;
  uniform float uTime;
  uniform vec3 uHot;
  uniform vec3 uWarm;
  uniform vec3 uDeep;
  uniform vec3 uTint;
  const float BOUND = ${BOUND.toFixed(2)};
  const float DIN = ${DISK_IN.toFixed(2)};
  const float DOUT = ${DISK_OUT.toFixed(2)};
  const float PERIOD = 40.0;

  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 x) {
    vec2 i = floor(x);
    vec2 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  // Ruído em faixas: esticado ao longo da órbita, apertado no raio (as listras do disco). Sem costura no ângulo.
  float bands(float r, float ang) {
    vec2 q = vec2(cos(ang), sin(ang)) * 2.2 + vec2(r * 2.4, -r * 1.7);
    float n = 0.0;
    float a = 0.55;
    for (int o = 0; o < FBM_N; o++) { n += a * vnoise(q * vec2(1.0, 1.0) + vec2(0.0, r * 3.0)); q = q * 2.03 + 7.1; a *= 0.5; }
    return n;
  }
  float turbulence(float r, float phi, float shear) {
    // Rotação diferencial: o miolo gira mais rápido (Kepler, ω ∝ r^-1,5).
    float ang = phi + shear * 0.9 * pow(r / DIN, -1.5);
    return bands(r, ang);
  }

  // Luz do disco num ponto (local, rs) para um fóton que viaja em 'dir'. Retorna luz emitida e opacidade.
  vec4 diskAt(vec3 p, vec3 dir) {
    float r = length(p.xy);
    if (r < DIN || r > DOUT) return vec4(0.0);
    float phi = atan(p.y, p.x);
    float a = fract(uTime / PERIOD);
    float b = fract(uTime / PERIOD + 0.5);
    float wa = 1.0 - abs(2.0 * a - 1.0);
    float n = wa * turbulence(r, phi, a * PERIOD) + (1.0 - wa) * turbulence(r, phi, b * PERIOD);
    // Perfil gaussiano no raio: pico perto do miolo, borda externa suave.
    float x = (r - DIN) / (DOUT - DIN);
    float profile = exp(-pow((x - 0.14) / 0.34, 2.0)) * smoothstep(0.0, 0.06, x) * (1.0 - smoothstep(0.7, 1.0, x));
    // Doppler: o lado que vem na direção da câmera fica mais claro e mais quente; o outro, mais escuro.
    vec3 tangent = normalize(vec3(-p.y, p.x, 0.0));
    float beta = 0.38 * sqrt(DIN / r);
    float g = sqrt(1.0 - beta * beta) / (1.0 - beta * dot(tangent, -dir));
    float heat = clamp(1.0 - x, 0.0, 1.0);
    vec3 col = mix(uDeep, uWarm, smoothstep(0.1, 0.65, heat));
    col = mix(col, uHot, smoothstep(0.6, 1.2, heat * g));
    col *= mix(vec3(1.0), uTint, 0.12);
    float lum = profile * (0.25 + 1.8 * n * n) * pow(g, 2.6);
    // Gás quente e fino: a opacidade acompanha o brilho (o lado escuro do disco não vira uma mancha cinza).
    float alpha = clamp(lum * 0.55, 0.0, 0.85);
    return vec4(col * lum * 1.6, alpha);
  }

  void main() {
    vec3 dirView = normalize(vView);
    vec3 dirWorld = normalize((vec4(dirView, 0.0) * viewMatrix).xyz);
    vec3 ro = uCam;
    vec3 rd = normalize(uToLocal * dirWorld);
    // Entrada na esfera que contém o buraco.
    float bq = dot(ro, rd);
    float cq = dot(ro, ro) - BOUND * BOUND;
    float disc = bq * bq - cq;
    if (disc <= 0.0) discard;
    float t0 = max(-bq - sqrt(disc), 0.0);
    vec3 p = ro + rd * t0;
    vec3 v = rd;
    vec3 hv = cross(p, v);
    float h2 = dot(hv, hv);

    vec3 col = vec3(0.0);
    float alpha = 0.0;
    float minR = 1e9;
    bool captured = false;
    for (int i = 0; i < STEPS_N; i++) {
      float r = length(p);
      minR = min(minR, r);
      if (r < 1.0) { captured = true; break; }
      if (r > BOUND + 0.01 && dot(p, v) > 0.0) break;
      float ds = clamp(0.1 * r * r / (r + 2.0), 0.03, 0.6);
      vec3 acc = -1.5 * h2 * p / pow(r, 5.0);
      vec3 v2 = v + acc * ds;
      vec3 p2 = p + v2 * ds;
      // Cruzou o plano do disco entre os dois passos: soma a luz no ponto do cruzamento.
      if (p.z * p2.z < 0.0) {
        vec3 hit = mix(p, p2, p.z / (p.z - p2.z));
        vec4 d = diskAt(hit, normalize(v2));
        col += (1.0 - alpha) * d.rgb;
        alpha += (1.0 - alpha) * d.a;
        if (alpha > 0.98) break;
      }
      p = p2;
      // Sem normalizar: nesta forma da equação a "velocidade" cresce perto do buraco e h fica constante.
      v = v2;
    }
    // Anel de fótons: raios que passaram rente à órbita dos fótons (1,5 rs) e escaparam.
    if (!captured) col += (1.0 - alpha) * uHot * exp(-pow((minR - 1.56) / 0.06, 2.0)) * 0.9;
    if (captured) alpha = 1.0;
    if (alpha < 0.002 && dot(col, col) < 1e-5) discard;
    // Compressão de brilho: o miolo chega perto do branco sem estourar.
    gl_FragColor = vec4(1.0 - exp(-col), alpha);
  }
`;

/** Quad do buraco negro com fótons. `r0`: raio da sombra no mundo; `steps`: passos por raio; `octaves`: camadas de ruído. */
export function createRayMarchedHole(options: {
  r0: number;
  tilt: Euler;
  steps: number;
  octaves: number;
  time: { value: number };
  colors: { uHot: { value: Color }; uWarm: { value: Color }; uDeep: { value: Color }; uTint: { value: Color } };
}): Mesh {
  const { r0, tilt, steps, octaves, time, colors } = options;
  const scale = SHADOW_RS / r0;
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    defines: { STEPS_N: Math.round(steps), FBM_N: Math.max(2, Math.min(5, Math.round(octaves))) },
    uniforms: {
      uBound: { value: BOUND / scale },
      uToLocal: { value: new Matrix3() },
      uCam: { value: new Vector3() },
      uTime: time,
      ...colors,
    },
    transparent: true,
    depthWrite: false,
    // Sem teste de profundidade: com a câmera perto, o quad podia ficar atrás da esfera preta e ela tampava o disco
    // da frente. O próprio raio já decide o que fica na frente (disco) e atrás (sombra).
    depthTest: false,
    // A luz do disco é emitida (soma); a opacidade só tampa o que está atrás (a sombra tampa tudo).
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
  });
  const mesh = new Mesh(new PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 9;
  // A cada quadro: câmera e direções no espaço do disco (a galáxia pode estar girada), já em raios de Schwarzschild.
  const tiltMatrix = new Matrix4().makeRotationFromEuler(tilt);
  const toDisk = new Matrix4();
  mesh.onBeforeRender = (_r, _s, camera) => {
    toDisk.multiplyMatrices(mesh.matrixWorld, tiltMatrix).invert();
    const u = material.uniforms;
    (u.uCam!.value as Vector3).setFromMatrixPosition(camera.matrixWorld).applyMatrix4(toDisk).multiplyScalar(scale);
    (u.uToLocal!.value as Matrix3).setFromMatrix4(toDisk);
  };
  return mesh;
}
