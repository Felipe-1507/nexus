import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  ShaderMaterial,
  type Vector3,
} from 'three';

/**
 * Rastro em fita contínua (modos Alta e Ultra): para cada nave, uma tira de `points` pontos que segue o caminho recente.
 * A fita fica sempre virada para a câmera (o alargamento é feito na tela), afina da nave para trás e esfria de cor:
 * começa na cor do motor e termina num azul apagado. Tudo numa malha só, atualizada na CPU a cada quadro.
 */
const VERTEX = /* glsl */ `
  attribute vec3 aNext;
  attribute float aSide;
  attribute float aAge;
  attribute vec3 aColor;
  attribute float aWidth;
  varying float vAge;
  varying float vSide;
  varying vec3 vColor;
  void main() {
    vec4 cur = modelViewMatrix * vec4(position, 1.0);
    vec4 nxt = modelViewMatrix * vec4(aNext, 1.0);
    vec2 d = nxt.xy - cur.xy;
    float len = length(d);
    d = len > 1e-5 ? d / len : vec2(1.0, 0.0);
    vec2 perp = vec2(-d.y, d.x);
    float w = aWidth * pow(1.0 - aAge, 0.8);
    cur.xy += perp * aSide * w;
    vAge = aAge;
    vSide = aSide;
    vColor = aColor;
    gl_Position = projectionMatrix * cur;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  varying float vAge;
  varying float vSide;
  varying vec3 vColor;
  void main() {
    // Mais claro no meio da fita, macio nas bordas; esfria e some com a idade.
    float edge = 1.0 - vSide * vSide;
    vec3 cold = vColor * vec3(0.45, 0.6, 1.0) * 0.5;
    vec3 col = mix(mix(vec3(1.0), vColor, 0.55), vColor, smoothstep(0.0, 0.15, vAge));
    col = mix(col, cold, smoothstep(0.1, 0.9, vAge));
    float a = pow(1.0 - vAge, 1.6) * edge * uOpacity;
    gl_FragColor = vec4(col * a, 1.0);
  }
`;

export class TrailRibbon {
  readonly mesh: Mesh;
  private readonly position: BufferAttribute;
  private readonly next: BufferAttribute;
  private readonly color: BufferAttribute;
  private readonly width: BufferAttribute;

  constructor(
    private readonly ships: number,
    private readonly points: number,
    opacity = 0.9,
  ) {
    const verts = ships * points * 2;
    const geometry = new BufferGeometry();
    this.position = new BufferAttribute(new Float32Array(verts * 3), 3);
    this.next = new BufferAttribute(new Float32Array(verts * 3), 3);
    this.color = new BufferAttribute(new Float32Array(verts * 3), 3);
    this.width = new BufferAttribute(new Float32Array(verts), 1);
    const side = new Float32Array(verts);
    const age = new Float32Array(verts);
    const index: number[] = [];
    for (let s = 0; s < ships; s++) {
      for (let k = 0; k < points; k++) {
        const v = (s * points + k) * 2;
        side[v] = -1;
        side[v + 1] = 1;
        age[v] = age[v + 1] = k / (points - 1);
        if (k < points - 1) index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      }
    }
    geometry.setAttribute('position', this.position);
    geometry.setAttribute('aNext', this.next);
    geometry.setAttribute('aColor', this.color);
    geometry.setAttribute('aWidth', this.width);
    geometry.setAttribute('aSide', new BufferAttribute(side, 1));
    geometry.setAttribute('aAge', new BufferAttribute(age, 1));
    geometry.setIndex(index);
    this.mesh = new Mesh(
      geometry,
      new ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: { uOpacity: { value: opacity } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      }),
    );
    this.mesh.frustumCulled = false;
  }

  /** Cor e largura (em unidades do mundo) da fita da nave `ship`. */
  style(ship: number, color: Color, width: number): void {
    for (let k = 0; k < this.points * 2; k++) {
      const v = ship * this.points * 2 + k;
      this.color.setXYZ(v, color.r, color.g, color.b);
      this.width.setX(v, width);
    }
    this.color.needsUpdate = true;
    this.width.needsUpdate = true;
  }

  /** Caminho da nave `ship`: `path[0]` é o motor, os seguintes vão para trás. Pontos que faltam repetem o último. */
  set(ship: number, path: ReadonlyArray<Vector3>): void {
    const n = this.points;
    const at = (k: number) => path[Math.min(k, path.length - 1)]!;
    for (let k = 0; k < n; k++) {
      const p = at(k);
      // O vizinho dá a direção da fita; no último ponto, a direção continua a do segmento anterior.
      const q = k < n - 1 ? at(k + 1) : at(k - 1);
      const nx = k < n - 1 ? q.x : 2 * p.x - q.x;
      const ny = k < n - 1 ? q.y : 2 * p.y - q.y;
      const nz = k < n - 1 ? q.z : 2 * p.z - q.z;
      const v = (ship * n + k) * 2;
      for (const o of [0, 1]) {
        this.position.setXYZ(v + o, p.x, p.y, p.z);
        this.next.setXYZ(v + o, nx, ny, nz);
      }
    }
  }

  touch(): void {
    this.position.needsUpdate = true;
    this.next.needsUpdate = true;
  }

  /** Esconde a fita da nave (largura zero). */
  hide(ship: number): void {
    this.style(ship, new Color(0, 0, 0), 0);
  }

  get count(): number {
    return this.ships;
  }
}
