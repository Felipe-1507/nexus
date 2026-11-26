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
  uniform float uMinPx;   // raio mínimo na tela, em pixels (0 = desligado)
  uniform float uPxScale; // pixels por unidade de mundo a 1 de distância
  varying vec3 vObj;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vA;
  varying vec3 vB;
  varying vec4 vP;
  varying vec4 vAt;
  varying float vGlow;
  varying float vMatch;
  varying vec3 vL;
  varying vec3 vBX;
  varying vec3 vBY;
  varying vec3 vBZ;
  void main() {
    vMatch = aMatch;
    // Rotação: a superfície gira em volta do eixo do planeta (a luz fica parada), cada um no seu ritmo e sentido.
    float speed = (0.05 + 0.1 * fract(aParams.y * 0.0137)) * (fract(aParams.y * 0.071) < 0.2 ? -1.0 : 1.0);
    float ang = uTime * speed;
    float cs = cos(ang);
    float sn = sin(ang);
    vObj = vec3(cs * position.x + sn * position.z, position.y, -sn * position.x + cs * position.z);
    vA = aColorA; vB = aColorB; vP = aParams; vAt = aAtmo; vGlow = aGlow;
    // De longe, o planeta nunca fica menor que 'uMinPx': vira um ponto de luz compacto em vez de sumir.
    float boost = 1.0;
    if (uMinPx > 0.0) {
      float dist = max(-(modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).z, 0.001);
      float pxR = length(instanceMatrix[0].xyz) * uPxScale / dist;
      boost = max(1.0, uMinPx / max(pxR, 1e-4));
    }
    vec4 mv = modelViewMatrix * instanceMatrix * vec4(position * boost, 1.0);
    vN = normalize(mat3(modelViewMatrix) * mat3(instanceMatrix) * normal);
    vV = normalize(-mv.xyz);
    // Base que leva direções da superfície (já girada) para a câmera: usada pelo relevo dos modos Alta/Ultra.
    mat3 toView = mat3(modelViewMatrix) * mat3(instanceMatrix);
    vBX = normalize(toView * vec3(cs, 0.0, sn));
    vBY = normalize(toView * vec3(0.0, 1.0, 0.0));
    vBZ = normalize(toView * vec3(-sn, 0.0, cs));
    // Direção do sol (que fica na origem do mundo) vista deste planeta: viewMatrix[3] é a origem em coordenadas da câmera.
    vL = viewMatrix[3].xyz - mv.xyz;
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
  varying vec3 vL;
  varying vec3 vBX;
  varying vec3 vBY;
  varying vec3 vBZ;
  uniform float uRim;
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
  float fbm(vec3 p) {
    float a = 0.5; float s = 0.0;
    for (int i = 0; i < OCTAVES; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
    return s;
  }

  // Relevo: poucas camadas e baixa frequência; detalhe fino demais vira chuvisco na tela.
  float relief(vec3 p) {
    float a = 0.5; float s = 0.0;
    for (int i = 0; i < 3; i++) { s += a * vnoise(p); p *= 2.1; a *= 0.5; }
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
      #if DETAIL > 0
      // Nuvens andam devagar sobre a superfície.
      float cloud = smoothstep(0.55, 0.78, fbm(q * 1.8 + 9.0 + vec3(uTime * 0.02, 0.0, uTime * 0.012)));
      #else
      float cloud = smoothstep(0.55, 0.78, fbm(q * 1.8 + 9.0));
      #endif
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

    // O lado claro olha para o sol; parte da luz continua vindo da câmera, para o outro lado não sumir.
    vec3 N = normalize(vN);
    vec3 V = normalize(vV);
    #if DETAIL > 0
    // Alta/Ultra: a luz vem quase toda do sol, com terminador suave, e o relevo (ruído) desvia a normal.
    vec3 L = normalize(mix(normalize(vec3(0.45, 0.55, 0.7)), normalize(vL), 0.88));
    float bumpK = kind < 0.5 ? 0.9 : kind < 1.5 ? 0.12 : kind < 2.5 ? 0.5 : kind < 3.5 ? 0.35 : kind < 4.5 ? 0.8 : kind < 5.5 ? 0.45 : 0.25;
    // Relevo calculado na própria esfera (diferenças finitas do ruído), sem depender dos pixels: não serrilha.
    // Perto do contorno o relevo some aos poucos: visto de lado ele vira serrilhado.
    float k = bumpK * (DETAIL > 1 ? 0.3 : 0.22) * smoothstep(0.05, 0.45, dot(normalize(vN), V));
    vec3 t1 = normalize(cross(p, abs(p.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 t2 = cross(p, t1);
    float e = 0.03;
    vec3 sc = vec3(vP.w * 1.6);
    vec3 off = vec3(seed * 1.7);
    float h0 = relief(p * sc + off);
    float h1 = relief(normalize(p + e * t1) * sc + off);
    float h2 = relief(normalize(p + e * t2) * sc + off);
    vec3 nObj = normalize(p - k * ((h1 - h0) / e * t1 + (h2 - h0) / e * t2));
    N = normalize(vBX * nObj.x + vBY * nObj.y + vBZ * nObj.z);
    if (dot(N, V) < 0.0) N = normalize(vN);
    float ndl = dot(N, L);
    float diff = smoothstep(-0.12, 1.0, ndl);
    float light = 0.07 + 1.15 * diff;
    #else
    vec3 L = normalize(mix(normalize(vec3(0.45, 0.55, 0.7)), normalize(vL), 0.45));
    float diff = max(dot(N, L), 0.0);
    float light = 0.2 + 0.95 * diff;
    #endif
    float rim = pow(1.0 - max(dot(N, V), 0.0), 2.6);

    vec3 outc = col * light + col * emissive;
    outc += vec3(spec * pow(max(dot(reflect(-L, N), V), 0.0), 24.0)) * 0.5;
    outc += vAt.rgb * rim * vAt.a * (0.35 + 0.9 * diff);   // atmosfera: brilho na borda
    // Fresnel discreto em todos os planetas: a borda iluminada destaca o volume contra o fundo escuro.
    outc += mix(col, vec3(0.75, 0.85, 1.0), 0.5) * rim * uRim * 0.35 * (0.3 + 0.7 * diff);
    #if DETAIL > 0
    // Dispersão atmosférica: halo fino na borda do lado do sol, alaranjado perto do terminador.
    vec3 sky = vAt.a > 0.0 ? vAt.rgb : mix(col, vec3(0.6, 0.75, 1.0), 0.6);
    float dayRim = rim * smoothstep(-0.25, 0.6, dot(normalize(vN), L));
    float dusk = rim * (1.0 - smoothstep(0.0, 0.35, abs(dot(normalize(vN), L))));
    outc += sky * dayRim * (DETAIL > 1 ? 0.75 : 0.5) + vec3(1.0, 0.55, 0.25) * dusk * 0.35;
    #endif
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
/** Tamanho mínimo dos planetas na tela (GE5): `uMinPx` em pixels (0 = como sempre) e `uPxScale`, que a cena mantém atualizado. */
export interface PlanetBoost {
  uMinPx: { value: number };
  uPxScale: { value: number };
}

/** `detail`: 0 = como sempre (Leve/Original), 1 = Alta, 2 = Ultra (relevo, terminador, dispersão e mais ruído). */
export function createPlanetMaterial(
  time: { value: number },
  rim: { value: number },
  boost: PlanetBoost = { uMinPx: { value: 0 }, uPxScale: { value: 1 } },
  detail = 0,
): ShaderMaterial {
  return new ShaderMaterial({
    defines: { DETAIL: detail, OCTAVES: detail === 0 ? 4 : detail === 1 ? 6 : 7 },
    vertexShader: PLANET_VERTEX,
    fragmentShader: PLANET_FRAGMENT,
    uniforms: { uTime: time, uRim: rim, ...boost },
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
    #if DETAIL > 0
    // Alta/Ultra: muitas faixas finas de partículas, uma divisão escura e transparência maior (nada de "alvo").
    float fine = 0.5 + 0.5 * sin(r * 140.0 + vS * 7.0) * sin(r * 53.0 + vS * 3.0);
    float gap = 1.0 - 0.9 * (1.0 - smoothstep(0.0, 0.035, abs(t - (0.58 + 0.12 * fract(vS * 0.37)))));
    float dens = (0.35 + 0.65 * smoothstep(0.0, 0.5, t)) * (1.0 - smoothstep(0.75, 1.0, t));
    float alpha = edge * gap * dens * (0.08 + 0.32 * fine * bands);
    gl_FragColor = vec4(vC * (0.75 + 0.45 * fine), alpha);
    #else
    float alpha = edge * (0.22 + 0.5 * bands) * 0.9;
    gl_FragColor = vec4(vC * (0.7 + 0.5 * bands), alpha);
    #endif
    #include <colorspace_fragment>
  }
`;

export function createRingMaterial(detail = 0): ShaderMaterial {
  return new ShaderMaterial({
    defines: { DETAIL: detail },
    vertexShader: RING_VERTEX,
    fragmentShader: RING_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
}
