import { DoubleSide, ShaderMaterial } from 'three';
import { PLANET_KINDS } from '@shared/planets';

/**
 * Materiais dos planetas e dos anéis. Cada planeta é uma instância de uma esfera só, e a aparência vem de atributos por
 * instância (cores, tipo, semente, atmosfera). A textura é calculada no shader, a partir da posição na esfera, então
 * não há imagens para carregar e cada planeta tem a sua.
 */

/** Índice do tipo no shader (a mesma ordem de PLANET_KINDS). */
export const kindIndex = (kind: (typeof PLANET_KINDS)[number]): number => PLANET_KINDS.indexOf(kind);

const PLANET_VERTEX = /* glsl */ `
  attribute vec3 aColorA;
  attribute vec3 aColorB;
  attribute vec4 aParams; // x: tipo, y: semente, z: força das faixas, w: escala do ruído
  attribute vec4 aAtmo;   // rgb: cor do brilho, a: força da atmosfera (0 = sem)
  attribute float aGlow;  // 0 a 1: nota mexida recentemente
  attribute float aMatch; // busca: 0 = normal, 1 = fora da busca (apagado), 2 = encontrado (aceso)
  uniform float uTime;
  varying vec3 vObj;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vA;
  varying vec3 vB;
  varying vec4 vP;
  varying vec4 vAt;
  varying float vGlow;
  varying float vMatch;
  void main() {
    vMatch = aMatch;
    // Rotação: a superfície gira em volta do eixo do planeta (a luz fica parada), cada um no seu ritmo e sentido.
    float speed = (0.05 + 0.1 * fract(aParams.y * 0.0137)) * (fract(aParams.y * 0.071) < 0.2 ? -1.0 : 1.0);
    float ang = uTime * speed;
    float cs = cos(ang);
    float sn = sin(ang);
    vObj = vec3(cs * position.x + sn * position.z, position.y, -sn * position.x + cs * position.z);
    vA = aColorA; vB = aColorB; vP = aParams; vAt = aAtmo; vGlow = aGlow;
    vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelViewMatrix) * mat3(instanceMatrix) * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const PLANET_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec3 vObj;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vA;
  varying vec3 vB;
  varying vec4 vP;
  varying vec4 vAt;
  varying float vGlow;
  varying float vMatch;
  uniform float uRim;

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
  float fbm(vec3 p) {
    float a = 0.5; float s = 0.0;
    for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
    return s;
  }

  void main() {
    vec3 p = normalize(vObj);
    float seed = vP.y;
    vec3 q = p * vP.w + seed * 1.7;
    float n = fbm(q);
    float kind = vP.x;
    vec3 col;
    float emissive = 0.0;
    float spec = 0.0;

    if (kind < 0.5) {            // rochoso: manchas e crateras
      col = mix(vB, vA, smoothstep(0.42, 0.62, n));
      col *= 0.82 + 0.3 * smoothstep(0.55, 0.85, vnoise(q * 3.0));
    } else if (kind < 1.5) {     // gasoso: faixas onduladas
      float warp = fbm(q * 1.5) * vP.z * 1.6;
      float band = 0.5 + 0.5 * sin(p.y * (6.0 + vP.w * 3.0) + warp * 4.0);
      col = mix(vB, vA, band);
      col = mix(col, vA, 0.25 * fbm(q * 3.0));
    } else if (kind < 2.5) {     // oceano: continentes e nuvens
      float land = smoothstep(0.50, 0.56, n);
      col = mix(vB, vA, land);
      float cloud = smoothstep(0.55, 0.78, fbm(q * 1.8 + 9.0));
      col = mix(col, vec3(1.0), cloud * 0.55);
      spec = (1.0 - land) * (1.0 - cloud) * 0.4;
    } else if (kind < 3.5) {     // gelo: claro, com rachaduras
      col = mix(vA, vB, smoothstep(0.35, 0.7, n));
      float crack = 1.0 - smoothstep(0.0, 0.03, abs(vnoise(q * 4.0) - 0.5));
      col = mix(col, vB * 0.75, crack * 0.5);
      spec = 0.5;
    } else if (kind < 4.5) {     // lava: rocha escura com veios incandescentes
      float veins = 1.0 - smoothstep(0.0, 0.05, abs(fbm(q * 1.3) - 0.5));
      col = mix(vA * (0.7 + 0.5 * n), vB, veins);
      emissive = veins * 1.1;
    } else if (kind < 5.5) {     // deserto: dunas em faixas suaves
      float band = 0.5 + 0.5 * sin(p.y * 7.0 + n * 5.0 + seed);
      col = mix(vB, vA, mix(n, band, 0.5));
    } else {                     // metálico: casco em placas, com linhas acesas entre elas
      float lat = asin(clamp(p.y, -1.0, 1.0));
      float lon = atan(p.z, p.x);
      vec2 grid = vec2(lon * 3.0, lat * 4.0) + seed;
      vec2 cell = abs(fract(grid) - 0.5);
      float seam = 1.0 - smoothstep(0.0, 0.05, 0.5 - max(cell.x, cell.y));
      float plate = vnoise(vec3(floor(grid), seed));
      col = mix(vB, mix(vB, vA, 0.35), plate) * (0.9 + 0.2 * n);
      // Sulcos escuros entre as placas; só alguns acendem (circuitos), o resto do casco fica fosco.
      float lit = seam * step(0.72, vnoise(vec3(floor(grid * 0.5), seed + 3.0)));
      col *= 1.0 - seam * 0.55;
      col = mix(col, vA, lit * 0.85);
      emissive = lit * 1.1;
      spec = 0.8;
    }

    vec3 L = normalize(vec3(0.45, 0.55, 0.7));
    vec3 N = normalize(vN);
    vec3 V = normalize(vV);
    float diff = max(dot(N, L), 0.0);
    float light = 0.2 + 0.95 * diff;
    float rim = pow(1.0 - max(dot(N, V), 0.0), 2.6);

    vec3 outc = col * light + col * emissive;
    outc += vec3(spec * pow(max(dot(reflect(-L, N), V), 0.0), 24.0)) * 0.5;
    outc += vAt.rgb * rim * vAt.a * (0.35 + 0.9 * diff);   // atmosfera: brilho na borda
    // Fresnel discreto em todos os planetas: a borda iluminada destaca o volume contra o fundo escuro.
    outc += mix(col, vec3(0.75, 0.85, 1.0), 0.5) * rim * uRim * 0.35 * (0.3 + 0.7 * diff);
    outc += col * 0.35 * vGlow;                            // nota recente
    // Busca: o que ficou de fora vira silhueta escura; o que foi encontrado ganha brilho e borda clara.
    float dimmed = step(0.5, vMatch) * (1.0 - step(1.5, vMatch));
    float found = step(1.5, vMatch);
    outc = mix(outc, outc * 0.12, dimmed);
    outc += (col * 0.25 + vec3(0.9, 0.95, 1.0) * rim * 0.9) * found;
    gl_FragColor = vec4(outc, 1.0);
    #include <colorspace_fragment>
  }
`;

/** `time` e `rim` são compartilhados com a cena: o relógio ambiente avança um e o perfil de qualidade define o outro. */
export function createPlanetMaterial(time: { value: number }, rim: { value: number }): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: PLANET_VERTEX,
    fragmentShader: PLANET_FRAGMENT,
    uniforms: { uTime: time, uRim: rim },
  });
}

/** Raio interno e externo do anel, em raios do planeta. */
export const RING_INNER = 1.5;
export const RING_OUTER = 2.4;

const RING_VERTEX = /* glsl */ `
  attribute vec4 aRing; // rgb: cor, a: semente
  varying vec2 vXY;
  varying vec3 vC;
  varying float vS;
  void main() {
    vXY = position.xy;
    vC = aRing.rgb;
    vS = aRing.a;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

const RING_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vXY;
  varying vec3 vC;
  varying float vS;
  void main() {
    float r = length(vXY);
    float t = clamp((r - ${RING_INNER.toFixed(2)}) / ${(RING_OUTER - RING_INNER).toFixed(2)}, 0.0, 1.0);
    float bands = 0.5 + 0.5 * sin(r * 38.0 + vS * 10.0) * (0.6 + 0.4 * sin(r * 11.0 + vS));
    float edge = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.9, 1.0, t));
    float alpha = edge * (0.22 + 0.5 * bands) * 0.9;
    gl_FragColor = vec4(vC * (0.7 + 0.5 * bands), alpha);
    #include <colorspace_fragment>
  }
`;

export function createRingMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: RING_VERTEX,
    fragmentShader: RING_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
}
