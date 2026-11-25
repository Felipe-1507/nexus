import { ACESFilmicToneMapping, NoToneMapping, Vector2, Vector4, type Camera, type Scene, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/** Acabamento de cinema dos modos Alta e Ultra. `null` no perfil = desenho direto, como sempre foi. */
export interface PostFxSettings {
  /** Brilho que "vaza" das partes claras (sol, disco, estrelas). */
  bloom: { strength: number; radius: number; threshold: number };
  /** Exposição do tone mapping ACES (cor de cinema). */
  exposure: number;
  /** Escurecimento das bordas (0 = nenhum). */
  vignette: number;
  /** Grão de filme (0 = nenhum). */
  grain: number;
  /** Separação de cores nas bordas, em fração da tela (0 = nenhuma). */
  chroma: number;
  /** Força da lente gravitacional em tela (estilo Eclipse): quanto as estrelas perto da sombra se curvam. */
  lens: number;
}

/**
 * Lente gravitacional em tela: cada pixel mostra o que estaria um pouco mais perto do centro, então
 * estrelas, poeira e o próprio disco se curvam em volta da sombra.
 * uLens: x, y = centro em NDC; z = raio da sombra em NDC (altura); w = proporção da tela.
 */
const LENS = {
  uniforms: {
    tDiffuse: { value: null },
    uLens: { value: new Vector4() },
    uOn: { value: 0 },
    uRing: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec4 uLens;
    uniform float uOn, uRing;
    varying vec2 vUv;
    void main() {
      if (uOn < 0.5 || uLens.z <= 0.0) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
      vec2 ndc = vUv * 2.0 - 1.0;
      vec2 d = (ndc - uLens.xy) * vec2(uLens.w, 1.0);
      float rho = max(length(d), 1e-4);
      float R = uLens.z;
      // A borda da sombra fica no lugar; logo fora dela a imagem é puxada para dentro (as estrelas se curvam em volta)
      // e o efeito some rápido com a distância.
      float beta = rho > R ? rho - uRing * R * ((rho - R) / R) * pow(R / rho, 3.0) : rho;
      vec2 src = uLens.xy + (d / rho) * beta / vec2(uLens.w, 1.0);
      vec3 col = texture2D(tDiffuse, clamp(src * 0.5 + 0.5, 0.001, 0.999)).rgb;
      // Depois do bloom: a sombra volta a ser preta de verdade (o brilho do disco não "vaza" para dentro).
      col *= smoothstep(R * 0.86, R * 0.97, rho);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

const FINISH = {
  uniforms: {
    tDiffuse: { value: null },
    vignette: { value: 0 },
    grain: { value: 0 },
    chroma: { value: 0 },
    time: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float vignette, grain, chroma, time;
    varying vec2 vUv;
    float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      vec2 off = d * chroma * r2 * 4.0;
      vec4 base = texture2D(tDiffuse, vUv);
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, base.g, texture2D(tDiffuse, vUv - off).b);
      col *= mix(1.0, smoothstep(0.85, 0.15, r2 * 2.2), vignette);
      // Grão só onde há luz: o fundo continua preto de verdade.
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col += (rand(vUv * 1000.0 + time) - 0.5) * grain * smoothstep(0.02, 0.25, lum);
      gl_FragColor = vec4(col, base.a);
    }
  `,
};

/** Cadeia de pós-processamento: cena → bloom → acabamento (vinheta, grão, cromática) → saída com ACES. */
export class PostFx {
  private readonly composer: EffectComposer;
  private readonly finish: ShaderPass;
  private readonly lens: ShaderPass;

  constructor(
    private readonly renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    settings: PostFxSettings,
  ) {
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = settings.exposure;
    const size = renderer.getSize(new Vector2());
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    const { strength, radius, threshold } = settings.bloom;
    this.composer.addPass(new UnrealBloomPass(size, strength, radius, threshold));
    this.finish = new ShaderPass(FINISH);
    this.finish.uniforms.vignette!.value = settings.vignette;
    this.finish.uniforms.grain!.value = settings.grain;
    this.finish.uniforms.chroma!.value = settings.chroma;
    // A lente vem depois do bloom, para poder devolver o preto à sombra.
    this.lens = new ShaderPass(LENS);
    this.lens.uniforms.uRing!.value = settings.lens;
    this.composer.addPass(this.lens);
    this.composer.addPass(this.finish);
    this.composer.addPass(new OutputPass());
    this.setSize(size.x, size.y);
  }

  /** Liga a lente em tela (só com o Eclipse) e atualiza o centro e o raio da sombra. */
  setLens(on: boolean, lens: Vector4): void {
    this.lens.uniforms.uOn!.value = on ? 1 : 0;
    (this.lens.uniforms.uLens!.value as Vector4).copy(lens);
  }

  setSize(width: number, height: number): void {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(width, height);
  }

  render(now: number): void {
    this.finish.uniforms.time!.value = (now / 1000) % 100;
    this.composer.render();
  }

  dispose(): void {
    this.composer.dispose();
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.toneMappingExposure = 1;
  }
}
