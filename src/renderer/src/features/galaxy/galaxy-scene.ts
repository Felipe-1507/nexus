import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  FogExp2,
  Group,
  HemisphereLight,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  InstancedBufferAttribute,
  Matrix4,
  MeshBasicMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Quaternion,
  Raycaster,
  RingGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Mesh,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { GalaxyGraph } from '@shared/knowledge';
import { hash01, planetColors, type PlanetStyle } from '@shared/planets';
import type { GalaxyLayout } from './layout';
import { createPlanetMaterial, createRingMaterial, kindIndex, RING_INNER, RING_OUTER } from './planet-material';

export interface GalaxyCallbacks {
  /** Planeta selecionado (clique ou busca); `null` = nada selecionado. */
  onSelect: (index: number | null) => void;
  /** Clique num planeta: abrir a nota. */
  onOpen: (index: number) => void;
}

const BACKGROUND = 0x05050b;
const ROUTE_OPACITY = 0.16;
const FLY_MS = 900;
const CLICK_SLOP_PX = 5;

// Halo: um ponto por planeta ou estrela, com tamanho e transparência próprios, apagando do centro para a borda.
const HALO_VERTEX = /* glsl */ `
  attribute float size;
  attribute float alpha;
  attribute vec3 color;
  varying float vAlpha;
  varying vec3 vColor;
  uniform float scale;
  void main() {
    vAlpha = alpha;
    vColor = color;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * scale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;
const HALO_FRAGMENT = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = pow(max(0.0, 1.0 - d), 2.2) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Cena da galáxia em Three.js. Planetas e estrelas são desenhados com instâncias (uma chamada para todos) e as rotas
 * num único conjunto de linhas, o que mantém a navegação fluida com milhares de notas.
 */
export class GalaxyScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(55, 1, 0.1, 6000);
  private readonly controls: OrbitControls;
  private readonly raycaster = new Raycaster();
  private readonly labels: HTMLDivElement;
  private readonly hoverLabel: HTMLDivElement;
  private readonly resize: ResizeObserver;
  private readonly content = new Group();
  private readonly highlight: LineSegments;
  private readonly haloMaterial: ShaderMaterial;

  private graph: GalaxyGraph = { notes: [], links: [] };
  private layout: GalaxyLayout = { systems: [], orbits: [], notes: [] };
  private planets: InstancedMesh | null = null;
  private systemLabels: Array<{ el: HTMLDivElement; pos: Vector3; extent: number }> = [];
  private selected: number | null = null;
  private hovered: number | null = null;
  private pointer: { x: number; y: number } | null = null;
  private down: { x: number; y: number } | null = null;
  private fly: {
    from: Vector3;
    to: Vector3;
    fromTarget: Vector3;
    toTarget: Vector3;
    t0: number;
  } | null = null;
  private frame = 0;
  private framed = false;
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: GalaxyCallbacks,
    private readonly options: {
      reducedMotion: boolean;
      /** Clique num planeta abre a nota (tela cheia). No painel, o clique só seleciona e leva a câmera até ele. */
      openOnClick: boolean;
    },
  ) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(BACKGROUND);
    this.renderer.domElement.className = 'absolute inset-0 size-full outline-none';
    container.appendChild(this.renderer.domElement);

    this.labels = document.createElement('div');
    this.labels.className = 'pointer-events-none absolute inset-0 overflow-hidden';
    this.hoverLabel = document.createElement('div');
    this.hoverLabel.className =
      'absolute top-0 left-0 hidden rounded-md bg-black/70 px-2 py-0.5 text-xs whitespace-nowrap text-white';
    this.labels.appendChild(this.hoverLabel);
    container.appendChild(this.labels);

    this.scene.fog = new FogExp2(BACKGROUND, 0.0009);
    this.scene.add(new HemisphereLight(0xdfe4ff, 0x1a1530, 1.6));
    const key = new DirectionalLight(0xffffff, 1.4);
    key.position.set(0.4, 1, 0.6);
    this.camera.add(key);
    this.scene.add(this.camera);
    this.scene.add(this.backgroundStars());
    this.scene.add(this.content);

    this.haloMaterial = new ShaderMaterial({
      vertexShader: HALO_VERTEX,
      fragmentShader: HALO_FRAGMENT,
      uniforms: { scale: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.highlight = new LineSegments(
      new BufferGeometry(),
      new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    this.scene.add(this.highlight);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxDistance = 3000;
    this.controls.minDistance = 2;
    this.controls.autoRotate = !options.reducedMotion;
    this.controls.autoRotateSpeed = 0.25;
    this.controls.addEventListener('start', () => {
      this.controls.autoRotate = false;
      this.fly = null;
    });

    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);

    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(container);
    this.fit();
    this.loop();
  }

  /** `styles`: a aparência de cada planeta, na mesma ordem de `graph.notes`. */
  setData(graph: GalaxyGraph, layout: GalaxyLayout, styles: PlanetStyle[]): void {
    this.wake();
    const selectedPath = this.selected === null ? null : this.graph.notes[this.selected]?.path;
    this.graph = graph;
    this.layout = layout;
    this.clearContent();
    this.buildSystems();
    this.buildOrbits();
    this.buildPlanets(styles);
    this.buildRoutes();
    const keep = selectedPath ? graph.notes.findIndex((n) => n.path === selectedPath) : -1;
    this.selected = keep >= 0 ? keep : null;
    this.hovered = null;
    this.updateHighlight();
    if (!this.framed && graph.notes.length > 0) {
      this.frameAll();
      this.framed = true;
    }
    this.container.dataset.planets = String(graph.notes.length);
    this.container.dataset.routes = String(graph.links.length);
    this.container.dataset.systems = String(layout.systems.length);
    this.container.dataset.ready = 'true';
  }

  /** Seleciona o planeta e leva a câmera até ele. */
  focus(index: number): void {
    this.wake();
    const p = this.layout.notes[index];
    if (!p) return;
    this.select(index);
    this.controls.autoRotate = false;
    const target = new Vector3(p.x, p.y, p.z);
    const offset = this.camera.position.clone().sub(this.controls.target);
    if (offset.lengthSq() < 1e-6) offset.set(0, 0.5, 1);
    const to = target.clone().add(offset.normalize().multiplyScalar(Math.max(10, p.size * 14)));
    if (this.options.reducedMotion) {
      this.camera.position.copy(to);
      this.controls.target.copy(target);
      this.container.dataset.flying = 'false';
      return;
    }
    this.fly = {
      from: this.camera.position.clone(),
      to,
      fromTarget: this.controls.target.clone(),
      toTarget: target,
      t0: performance.now(),
    };
    this.container.dataset.flying = 'true';
  }

  select(index: number | null): void {
    this.wake();
    this.selected = index;
    this.container.dataset.selected = index === null ? '' : (this.graph.notes[index]?.path ?? '');
    this.updateHighlight();
    this.callbacks.onSelect(index);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    this.controls.dispose();
    this.clearContent();
    this.scene.traverse((obj) => {
      const o = obj as Mesh;
      o.geometry?.dispose();
      const materials = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of materials) m.dispose();
    });
    this.haloMaterial.dispose();
    this.renderer.dispose();
    canvas.remove();
    this.labels.remove();
  }

  // ---- construção da cena ----

  private backgroundStars(): Points {
    const rand = seeded(7);
    const count = 2500;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const u = rand() * 2 - 1;
      const phi = rand() * Math.PI * 2;
      const r = 2200 + rand() * 1500;
      const s = Math.sqrt(1 - u * u);
      positions.set([r * s * Math.cos(phi), r * u, r * s * Math.sin(phi)], i * 3);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    const material = new PointsMaterial({
      color: 0xbfc3e6,
      size: 1.3,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.7,
      fog: false,
    });
    return new Points(geometry, material);
  }

  /** Traço fino de cada órbita no plano do sistema, na cor dele: mostra de onde cada planeta gira em volta da estrela. */
  private buildOrbits(): void {
    const { systems, orbits } = this.layout;
    if (orbits.length === 0) return;
    const SEGMENTS = 96;
    const positions = new Float32Array(orbits.length * SEGMENTS * 6);
    const colors = new Float32Array(orbits.length * SEGMENTS * 6);
    const c = new Color();
    let k = 0;
    for (const o of orbits) {
      const s = systems[o.system]!;
      c.set(s.color);
      for (let i = 0; i < SEGMENTS; i++) {
        for (const j of [i, i + 1]) {
          const a = (j / SEGMENTS) * Math.PI * 2;
          positions.set([s.x + Math.cos(a) * o.radius, s.y, s.z + Math.sin(a) * o.radius], k * 3);
          c.toArray(colors, k * 3);
          k++;
        }
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    const material = new LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.content.add(new LineSegments(geometry, material));
  }

  private buildSystems(): void {
    const { systems } = this.layout;
    const star = new InstancedMesh(
      new SphereGeometry(1, 20, 14),
      new MeshBasicMaterial({ color: 0xffffff }),
      Math.max(1, systems.length),
    );
    star.count = systems.length;
    const m = new Matrix4();
    const color = new Color();
    const halo = this.haloPoints(systems.length);
    systems.forEach((s, i) => {
      const r = 1.3 + 0.15 * Math.sqrt(s.count);
      m.makeScale(r, r, r).setPosition(s.x, s.y, s.z);
      star.setMatrixAt(i, m);
      star.setColorAt(i, color.set(s.color).lerp(new Color(0xffffff), 0.55));
      halo.set(i, s, color.set(s.color), r * 12, 0.9);
    });
    this.content.add(star, halo.points, this.nebula());

    this.systemLabels = systems.map((s) => {
      const el = document.createElement('div');
      el.className =
        'absolute top-0 left-0 text-[11px] font-semibold tracking-wide whitespace-nowrap text-white/85 uppercase [text-shadow:0_1px_4px_#000]';
      el.textContent = s.name || 'Núcleo';
      this.labels.appendChild(el);
      return { el, pos: new Vector3(s.x, s.y + 1.6 + 0.12 * Math.sqrt(s.count), s.z), extent: s.extent };
    });
  }

  /** Poeira luminosa em volta de cada sistema: de longe, é ela que faz o conjunto parecer uma galáxia. */
  private nebula(): Points {
    const rand = seeded(11);
    const per = this.layout.systems.map((s) => Math.min(400, 60 + s.count * 8));
    const halo = this.haloPoints(per.reduce((a, b) => a + b, 0));
    const color = new Color();
    let k = 0;
    this.layout.systems.forEach((s, i) => {
      color.set(s.color);
      for (let n = 0; n < per[i]!; n++) {
        // Distribuição concentrada no centro (soma de sorteios ≈ normal), achatada como um disco.
        const g = () => (rand() + rand() + rand() - 1.5) / 1.5;
        const spread = s.extent * 1.3;
        const p = { x: s.x + g() * spread, y: s.y + g() * spread * 0.25, z: s.z + g() * spread };
        halo.set(k++, p, color, 6 + rand() * 10, 0.035 + rand() * 0.05);
      }
    });
    return halo.points;
  }

  private buildPlanets(styles: PlanetStyle[]): void {
    const { notes } = this.layout;
    const n = notes.length;
    const geometry = new SphereGeometry(1, 28, 20);
    const colorA = new Float32Array(n * 3);
    const colorB = new Float32Array(n * 3);
    const params = new Float32Array(n * 4);
    const atmo = new Float32Array(n * 4);
    const glow = new Float32Array(n);
    geometry.setAttribute('aColorA', new InstancedBufferAttribute(colorA, 3));
    geometry.setAttribute('aColorB', new InstancedBufferAttribute(colorB, 3));
    geometry.setAttribute('aParams', new InstancedBufferAttribute(params, 4));
    geometry.setAttribute('aAtmo', new InstancedBufferAttribute(atmo, 4));
    geometry.setAttribute('aGlow', new InstancedBufferAttribute(glow, 1));

    const mesh = new InstancedMesh(geometry, createPlanetMaterial(), Math.max(1, n));
    mesh.count = n;
    const m = new Matrix4();
    const c = new Color();
    const halo = this.haloPoints(n);
    const rings: number[] = [];

    notes.forEach((p, i) => {
      const style = styles[i]!;
      const colors = planetColors(style);
      m.makeScale(p.size, p.size, p.size).setPosition(p.x, p.y, p.z);
      mesh.setMatrixAt(i, m);
      c.set(colors.a).toArray(colorA, i * 3);
      c.set(colors.b).toArray(colorB, i * 3);
      params.set(
        [
          kindIndex(style.kind),
          style.seed,
          0.4 + 0.6 * hash01(`band:${style.seed}`),
          1.6 + 2.4 * hash01(`scale:${style.seed}`),
        ],
        i * 4,
      );
      c.set(colors.glow).toArray(atmo, i * 4);
      atmo[i * 4 + 3] = style.atmosphere ? 0.9 : 0;
      glow[i] = p.glow;
      // Halo: colorido pela atmosfera; sem ela, só o brilho discreto das notas recentes.
      halo.set(
        i,
        p,
        c.set(style.atmosphere ? colors.glow : this.layout.systems[p.system]!.color),
        p.size * (style.atmosphere ? 4.2 : 3) * (1 + 0.8 * p.glow),
        (style.atmosphere ? 0.28 : 0.1) + 0.5 * p.glow,
      );
      if (style.ring) rings.push(i);
    });
    mesh.computeBoundingSphere();
    this.planets = mesh;
    this.content.add(mesh, halo.points);
    if (rings.length > 0) this.content.add(this.buildRings(rings, styles));
  }

  /** Anéis: um disco por planeta, inclinado de um jeito próprio, desenhado todo de uma vez. */
  private buildRings(indices: number[], styles: PlanetStyle[]): InstancedMesh {
    const geometry = new RingGeometry(RING_INNER, RING_OUTER, 64, 1);
    const colorSeed = new Float32Array(indices.length * 4);
    geometry.setAttribute('aRing', new InstancedBufferAttribute(colorSeed, 4));
    const mesh = new InstancedMesh(geometry, createRingMaterial(), indices.length);
    const m = new Matrix4();
    const q = new Quaternion();
    const c = new Color();
    const axisX = new Vector3(1, 0, 0);
    const axisZ = new Vector3(0, 0, 1);
    const tilt = new Quaternion();
    indices.forEach((planet, k) => {
      const p = this.layout.notes[planet]!;
      const style = styles[planet]!;
      // O anel nasce no plano XY: deita-se no plano da galáxia e ganha uma inclinação e um giro só dele.
      q.setFromAxisAngle(axisX, Math.PI / 2 + (hash01(`tilt:${style.seed}`) - 0.5) * 0.9);
      tilt.setFromAxisAngle(axisZ, hash01(`spin:${style.seed}`) * Math.PI);
      q.premultiply(tilt);
      m.compose(new Vector3(p.x, p.y, p.z), q, new Vector3(p.size, p.size, p.size));
      mesh.setMatrixAt(k, m);
      c.set(planetColors(style).glow).toArray(colorSeed, k * 4);
      colorSeed[k * 4 + 3] = style.seed;
    });
    return mesh;
  }

  private buildRoutes(): void {
    const { links } = this.graph;
    const positions = new Float32Array(links.length * 6);
    const colors = new Float32Array(links.length * 6);
    const c = new Color();
    links.forEach(([a, b], i) => {
      const pa = this.layout.notes[a]!;
      const pb = this.layout.notes[b]!;
      positions.set([pa.x, pa.y, pa.z, pb.x, pb.y, pb.z], i * 6);
      c.set(this.layout.systems[pa.system]!.color);
      colors.set([c.r, c.g, c.b], i * 6);
      c.set(this.layout.systems[pb.system]!.color);
      colors.set([c.r, c.g, c.b], i * 6 + 3);
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    const material = new LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: ROUTE_OPACITY,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.content.add(new LineSegments(geometry, material));
  }

  private haloPoints(count: number) {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const alphas = new Float32Array(count);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    geometry.setAttribute('size', new BufferAttribute(sizes, 1));
    geometry.setAttribute('alpha', new BufferAttribute(alphas, 1));
    const points = new Points(geometry, this.haloMaterial);
    return {
      points,
      set(i: number, p: { x: number; y: number; z: number }, color: Color, size: number, alpha: number) {
        positions.set([p.x, p.y, p.z], i * 3);
        colors.set([color.r, color.g, color.b], i * 3);
        sizes[i] = size;
        alphas[i] = alpha;
      },
    };
  }

  private clearContent(): void {
    for (const child of [...this.content.children]) {
      this.content.remove(child);
      const o = child as Mesh;
      o.geometry?.dispose();
      // O material dos halos é compartilhado e só é liberado no dispose().
      if (o.material && o.material !== this.haloMaterial) (o.material as Material).dispose();
    }
    for (const label of this.systemLabels) label.el.remove();
    this.systemLabels = [];
    this.planets = null;
  }

  private updateHighlight(): void {
    const focus = this.selected ?? this.hovered;
    const positions: number[] = [];
    if (focus !== null) {
      for (const [a, b] of this.graph.links) {
        if (a !== focus && b !== focus) continue;
        const pa = this.layout.notes[a]!;
        const pb = this.layout.notes[b]!;
        positions.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z);
      }
    }
    this.highlight.geometry.dispose();
    this.highlight.geometry = new BufferGeometry();
    this.highlight.geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  }

  private frameAll(): void {
    // Centro do conjunto (a espiral cresce para um lado, então o núcleo não fica no meio do desenho).
    const { systems } = this.layout;
    const minX = Math.min(...systems.map((s) => s.x - s.extent));
    const maxX = Math.max(...systems.map((s) => s.x + s.extent));
    const minZ = Math.min(...systems.map((s) => s.z - s.extent));
    const maxZ = Math.max(...systems.map((s) => s.z + s.extent));
    const center = new Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    let radius = 20;
    for (const s of systems) radius = Math.max(radius, Math.hypot(s.x - center.x, s.z - center.z) + s.extent);
    // Distância em que uma esfera desse raio cabe no menor dos dois ângulos de visão (vertical ou horizontal). A esfera,
    // e não só o disco, porque a câmera gira em volta do centro e o lado mais comprido muda de posição.
    const vFov = (this.camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const distance = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 0.9;
    this.controls.target.copy(center);
    this.camera.position.set(0, 0.55, 0.83).normalize().multiplyScalar(distance).add(center);
    this.controls.update();
  }

  // ---- interação ----

  private pick(x: number, y: number): number | null {
    if (!this.planets || this.graph.notes.length === 0) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.planets, false)[0];
    return hit?.instanceId ?? null;
  }

  private onPointerMove = (e: PointerEvent) => {
    this.pointer = { x: e.clientX, y: e.clientY };
  };

  private onPointerLeave = () => {
    this.pointer = null;
  };

  private onPointerDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY };
  };

  private onPointerUp = (e: PointerEvent) => {
    const down = this.down;
    this.down = null;
    if (e.button !== 0 || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_SLOP_PX) return;
    const index = this.pick(e.clientX, e.clientY);
    if (index === null) {
      this.select(null);
      return;
    }
    this.focus(index);
    if (this.options.openOnClick) this.callbacks.onOpen(index);
  };

  // ---- quadro a quadro ----

  private fit(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.wake();
    this.haloMaterial.uniforms.scale!.value = h * this.renderer.getPixelRatio() * 0.6;
  }

  /** Marca a cena como alterada: o próximo quadro é desenhado (mesmo sem a câmera ter se mexido). */
  private wake(): void {
    this.dirty = true;
  }

  private dirty = true;
  /** Última posição do ponteiro já examinada (o raycast só roda quando ela muda ou a câmera se mexe). */
  private lastPick = '';

  private loop = () => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.loop);
    // Aba escondida, janela minimizada ou painel fechado: nada a desenhar.
    if (document.hidden || this.container.clientWidth === 0 || this.container.clientHeight === 0) return;

    if (this.fly) {
      const t = Math.min(1, (performance.now() - this.fly.t0) / FLY_MS);
      const k = easeInOut(t);
      this.camera.position.lerpVectors(this.fly.from, this.fly.to, k);
      this.controls.target.lerpVectors(this.fly.fromTarget, this.fly.toTarget, k);
      if (t === 1) {
        this.fly = null;
        this.container.dataset.flying = 'false';
      }
    }
    const moved = this.controls.update();

    // Parada (câmera quieta, ponteiro no mesmo lugar, nada mudou): não redesenha nem refaz o raycast.
    const pointerKey = this.pointer && !this.down ? `${this.pointer.x},${this.pointer.y}` : '';
    if (!moved && !this.dirty && !this.fly && pointerKey === this.lastPick) return;
    this.lastPick = pointerKey;
    this.dirty = false;

    const hovered = this.pointer && !this.down ? this.pick(this.pointer.x, this.pointer.y) : null;
    if (hovered !== this.hovered) {
      this.hovered = hovered;
      this.renderer.domElement.style.cursor = hovered === null ? 'grab' : 'pointer';
      if (this.selected === null) this.updateHighlight();
    }
    this.updateLabels();
    this.renderer.render(this.scene, this.camera);
  };

  private project(v: Vector3): { x: number; y: number; visible: boolean } {
    const p = v.clone().project(this.camera);
    return {
      x: ((p.x + 1) / 2) * this.container.clientWidth,
      y: ((1 - p.y) / 2) * this.container.clientHeight,
      visible: p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1,
    };
  }

  private updateLabels(): void {
    for (const label of this.systemLabels) {
      const s = this.project(label.pos);
      // Nome do sistema só quando ele ocupa espaço na tela: de longe, centenas de nomes virariam ruído.
      const dist = this.camera.position.distanceTo(label.pos);
      const opacity = s.visible ? Math.max(0, Math.min(1, (label.extent * 24) / dist - 0.2)) : 0;
      label.el.style.opacity = String(opacity);
      if (opacity > 0) label.el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
    }
    const focus = this.hovered ?? this.selected;
    const note = focus === null ? undefined : this.graph.notes[focus];
    const p = focus === null ? undefined : this.layout.notes[focus];
    if (!note || !p) {
      this.hoverLabel.classList.add('hidden');
      return;
    }
    const s = this.project(new Vector3(p.x, p.y + p.size * 1.6, p.z));
    this.hoverLabel.classList.toggle('hidden', !s.visible);
    this.hoverLabel.textContent = note.title;
    this.hoverLabel.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
  }
}
