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
import { createComets, createFlows, isImportantRoute } from './route-effects';
import { createShips, galaxyRadius } from './ship-effects';
import { ActivityLayer, type Spot } from './activity-effects';
import { createNebulaMaterial, createShootingStars, haloBuffer, seeded, shaderClock, type Effect } from './effects';
import { AmbientClock, ambientFrameDue, ambientInterval, type Animator } from './ambient';
import type { GalaxyProfile } from './quality';
import { planTour, TOUR_DWELL_MS, TOUR_FLY_MS, type TourStop } from './explore';
import { createMoons, MOON_LABELS, moonKind, moonName, moonPosition, planMoons, type MoonPlan } from './moon-effects';
import { createPlanetMaterial, createRingMaterial, kindIndex, RING_INNER, RING_OUTER } from './planet-material';

export interface GalaxyCallbacks {
  /** Planeta selecionado (clique ou busca); `null` = nada selecionado. */
  onSelect: (index: number | null) => void;
  /** Clique num planeta: abrir a nota. */
  onOpen: (index: number) => void;
  /** Clique numa lua: abrir o anexo `name` da nota `index`. */
  onMoon?: (index: number, name: string) => void;
  /** Tour guiado (G9): parada atual, ou null quando termina ou é interrompido. */
  onTour?: (state: { index: number; total: number; stop: TourStop } | null) => void;
}

const BACKGROUND = 0x05050b;
const ROUTE_OPACITY = 0.16;
const FLY_MS = 900;
/** Velocidade do giro automático: o normal, o do modo contemplativo e o das paradas do tour. */
const SPIN_SPEED = 0.25;
const CONTEMPLATIVE_SPIN = 0.35;
const TOUR_SPIN = 0.9;
const CLICK_SLOP_PX = 5;
/** Quanto o amortecimento da câmera continua agindo depois que o usuário solta. */
const SETTLE_MS = 2000;

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
    duration: number;
  } | null = null;
  /** Tour guiado em andamento (G9) e modo contemplativo. */
  private tour: { stops: TourStop[]; index: number; next: number } | null = null;
  private contemplative = false;
  private frame = 0;
  private framed = false;
  private disposed = false;
  private profile: GalaxyProfile;
  private stars: Points[];
  /** Tempo dos shaders (rotação dos planetas, deriva da nebulosa) e força do brilho de borda, pelo perfil. */
  private readonly time = { value: 0 };
  private readonly rim: { value: number };
  /** Animações dos efeitos da cena atual (saem do relógio quando a cena é refeita). */
  private effectRemovers: Array<() => void> = [];
  /** Efeitos que sobrevivem à cena ser refeita (naves ambientais, estrelas cadentes), por modo. */
  private persistent: { quality: string; effects: Effect[]; removers: Array<() => void> } | null = null;
  /** Naves do Claude e pulsos das notas alteradas (G5). */
  private readonly activity: ActivityLayer | null;
  /** Nota (caminho em minúsculas) → índice no grafo atual. */
  private pathIndex = new Map<string, number>();
  private styles: PlanetStyle[] = [];
  /** Luas de anexos da cena atual (G7) e a que está sob o ponteiro. */
  private moons: MoonPlan[] = [];
  private hoveredMoon: number | null = null;
  private moonMesh: InstancedMesh | null = null;
  /** Busca visual (G8): notas encontradas (null = sem busca) e o que é preciso para acender e apagar sem refazer a cena. */
  private search: Set<number> | null = null;
  private planetHalo: { halo: ReturnType<typeof haloBuffer>; alphas: Float32Array; sizes: Float32Array } | null = null;
  private routeColors: { attribute: BufferAttribute; base: Float32Array } | null = null;
  /** Giro automático da câmera (para quando o usuário mexe nela). É movimento ambiente: segue o limite do perfil. */
  private autoRotate: boolean;
  /** Animações ambientes das próximas etapas (naves, cometas, pulsos). */
  private readonly ambient = new AmbientClock();
  private lastAmbient = -Infinity;
  /** Usuário mexendo na câmera, e até quando o amortecimento ainda move a câmera depois que ele solta. */
  private interacting = false;
  private settleUntil = 0;
  /** Quadros desenhados (exposto de tempos em tempos para os testes medirem o consumo). */
  private rendered = 0;
  private lastStats = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: GalaxyCallbacks,
    private readonly options: {
      reducedMotion: boolean;
      /** Clique num planeta abre a nota (tela cheia). No painel, o clique só seleciona e leva a câmera até ele. */
      openOnClick: boolean;
      /** Modo Leve ou Original (quality.ts). Pode ser trocado depois com `setProfile`. */
      profile: GalaxyProfile;
    },
  ) {
    this.profile = options.profile;
    this.rim = { value: options.profile.rim };
    this.autoRotate = !options.reducedMotion;
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.profile.maxPixelRatio));
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
    this.stars = this.backgroundStars();
    this.scene.add(...this.stars);
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
    this.controls.autoRotate = false;
    this.controls.autoRotateSpeed = SPIN_SPEED;
    this.controls.addEventListener('end', () => {
      this.interacting = false;
      this.settleUntil = performance.now() + SETTLE_MS;
    });
    this.controls.addEventListener('start', () => {
      this.interacting = true;
      this.autoRotate = false;
      this.fly = null;
      // Mexer na câmera assume o controle: o tour para.
      if (this.tour) this.stopTour();
    });

    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);

    this.activity = options.reducedMotion
      ? null
      : new ActivityLayer({
          material: this.haloMaterial,
          profile: () => this.profile,
          locate: (p) => this.locate(p),
          locateSystem: (p) => this.locateSystem(p),
          radius: () => galaxyRadius(this.layout),
          rand: seeded(31),
          start: (a) => this.animate(a),
        });
    if (this.activity) this.scene.add(...this.activity.objects);

    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(container);
    this.container.dataset.quality = this.profile.quality;
    this.fit();
    this.loop();
  }

  /**
   * Troca o modo (Leve ou Original) sem recriar a cena: a câmera, a seleção e a posição dos planetas ficam como estão.
   */
  setProfile(profile: GalaxyProfile): void {
    if (profile.quality === this.profile.quality) return;
    this.profile = profile;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, profile.maxPixelRatio));
    this.rim.value = profile.rim;
    for (const layer of this.stars) {
      this.scene.remove(layer);
      layer.geometry.dispose();
      (layer.material as Material).dispose();
    }
    this.stars = this.backgroundStars();
    this.scene.add(...this.stars);
    if (this.graph.notes.length > 0) this.setData(this.graph, this.layout, this.styles);
    this.container.dataset.quality = profile.quality;
    this.fit();
  }

  /** O Claude começou a criar ou editar uma nota (caminho relativo ao vault): uma nave vai até ela. */
  claudeEdit(path: string): void {
    if (!this.activity || !this.visible()) return;
    this.activity.claudeEdit(path);
    this.publishActivity();
  }

  /** Notas alteradas no disco (pelo Claude, pelo editor ou por outro programa): pulso no planeta. */
  notesChanged(paths: string[]): void {
    if (!this.activity || !this.visible() || paths.length === 0) return;
    this.activity.notesChanged(paths.map((path) => ({ path, existed: this.pathIndex.has(path.toLowerCase()) })));
    this.publishActivity();
  }

  private visible(): boolean {
    return !document.hidden && this.container.clientWidth > 0 && this.container.clientHeight > 0;
  }

  private publishActivity(): void {
    if (!this.activity) return;
    this.container.dataset.activityShips = String(this.activity.stats.ships);
    this.container.dataset.pulses = String(this.activity.stats.pulses);
    this.container.dataset.grouped = String(this.activity.stats.grouped);
  }

  private locate(path: string): Spot | null {
    const i = this.pathIndex.get(path.toLowerCase());
    const p = i === undefined ? undefined : this.layout.notes[i];
    return p ? { x: p.x, y: p.y, z: p.z, size: p.size } : null;
  }

  private locateSystem(path: string): Spot | null {
    const name = path.includes('/') ? path.slice(0, path.indexOf('/')) : '';
    const s = this.layout.systems.find((x) => x.name.toLowerCase() === name.toLowerCase());
    return s ? { x: s.x, y: s.y, z: s.z, size: 1.3 + 0.15 * Math.sqrt(s.count) } : null;
  }

  /** Registra uma animação ambiente (naves, cometas, pulsos); devolve a função que a remove. */
  animate(animator: Animator): () => void {
    this.wake();
    return this.ambient.add(animator);
  }

  /** `styles`: a aparência de cada planeta, na mesma ordem de `graph.notes`. */
  setData(graph: GalaxyGraph, layout: GalaxyLayout, styles: PlanetStyle[]): void {
    this.wake();
    const selectedPath = this.selected === null ? null : this.graph.notes[this.selected]?.path;
    this.graph = graph;
    this.layout = layout;
    this.styles = styles;
    this.pathIndex = new Map(graph.notes.map((n, i) => [n.path.toLowerCase(), i]));
    this.clearContent();
    this.buildSystems();
    this.buildOrbits();
    this.buildPlanets(styles);
    this.buildMoons();
    this.buildRoutes();
    this.buildEffects();
    if (this.search) {
      // A cena foi refeita (nota alterada): a busca continua valendo para as notas que ainda existem.
      const paths = new Set([...this.search].map((i) => this.previousPaths[i]).filter(Boolean));
      this.search = new Set(graph.notes.flatMap((n, i) => (paths.has(n.path) ? [i] : [])));
    }
    this.previousPaths = graph.notes.map((n) => n.path);
    this.applySearch();
    const keep = selectedPath ? graph.notes.findIndex((n) => n.path === selectedPath) : -1;
    this.selected = keep >= 0 ? keep : null;
    this.hovered = null;
    this.hoveredMoon = null;
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

  /**
   * Busca visual: acende as notas encontradas e apaga o resto (planetas, halos, luas e rotas), sem refazer a cena.
   * `null` volta tudo ao normal.
   */
  setSearch(matches: number[] | null): void {
    this.search = matches ? new Set(matches) : null;
    this.applySearch();
    this.wake();
  }

  /** Leva a câmera a enquadrar estas notas (os resultados da busca). */
  frameNotes(indices: number[]): void {
    const points = indices.map((i) => this.layout.notes[i]).filter((p) => p !== undefined);
    if (points.length === 0) return;
    if (points.length === 1) {
      this.focus(indices[0]!);
      return;
    }
    this.wake();
    this.autoRotate = false;
    const center = new Vector3();
    for (const p of points) center.add(new Vector3(p.x, p.y, p.z));
    center.divideScalar(points.length);
    let radius = 6;
    for (const p of points) radius = Math.max(radius, center.distanceTo(new Vector3(p.x, p.y, p.z)) + p.size * 3);
    const vFov = (this.camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const distance = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.05;
    const offset = this.camera.position.clone().sub(this.controls.target);
    if (offset.lengthSq() < 1e-6) offset.set(0, 0.5, 1);
    this.flyTo(center.clone().add(offset.normalize().multiplyScalar(distance)), center);
  }

  private flyTo(to: Vector3, target: Vector3, duration = FLY_MS): void {
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
      duration,
    };
    this.container.dataset.flying = 'true';
  }

  // ---- exploração (G9) ----

  /** Começa o tour guiado: visão geral, depois os sistemas e as notas centrais, uma parada de cada vez. */
  startTour(): void {
    this.wake();
    this.setContemplative(false);
    if (this.selected !== null) this.select(null);
    this.tour = { stops: planTour(this.graph, this.layout), index: -1, next: 0 };
    this.nextStop();
  }

  /** Vai para a próxima parada do tour (ou termina, depois da última). */
  nextStop(): void {
    const tour = this.tour;
    if (!tour) return;
    tour.index++;
    const stop = tour.stops[tour.index];
    if (!stop) {
      this.stopTour();
      return;
    }
    this.wake();
    this.autoRotate = false;
    const pose = this.poseFor(stop);
    this.flyTo(pose.position, pose.target, TOUR_FLY_MS);
    tour.next = performance.now() + (this.options.reducedMotion ? 0 : TOUR_FLY_MS) + TOUR_DWELL_MS;
    this.container.dataset.tour = `${tour.index + 1}/${tour.stops.length}`;
    this.callbacks.onTour?.({ index: tour.index, total: tour.stops.length, stop });
  }

  stopTour(): void {
    if (!this.tour) return;
    this.tour = null;
    this.autoRotate = false;
    this.controls.autoRotateSpeed = SPIN_SPEED;
    this.container.dataset.tour = '';
    this.callbacks.onTour?.(null);
  }

  /** Modo contemplativo: a câmera se afasta e a galáxia gira devagar (a tela esconde os controles). */
  setContemplative(on: boolean): void {
    if (on === this.contemplative) return;
    this.contemplative = on;
    this.container.dataset.contemplative = String(on);
    this.wake();
    if (!on) {
      this.controls.autoRotateSpeed = SPIN_SPEED;
      return;
    }
    this.stopTour();
    if (this.selected !== null) this.select(null);
    const pose = this.overviewPose();
    this.flyTo(pose.position, pose.target, TOUR_FLY_MS);
    this.controls.autoRotateSpeed = CONTEMPLATIVE_SPIN;
    this.autoRotate = !this.options.reducedMotion;
  }

  /** Onde a câmera fica em cada parada: de cima, de lado, sem mudar demais a direção de onde ela já olha. */
  private poseFor(stop: TourStop): { position: Vector3; target: Vector3 } {
    if (stop.kind === 'overview') return this.overviewPose();
    const p = stop.kind === 'system' ? this.layout.systems[stop.system]! : this.layout.notes[stop.note]!;
    const target = new Vector3(p.x, p.y, p.z);
    const distance =
      stop.kind === 'system'
        ? Math.max(20, this.layout.systems[stop.system]!.extent * 2.8)
        : Math.max(10, this.layout.notes[stop.note]!.size * 14);
    const dir = this.camera.position.clone().sub(this.controls.target);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize().multiplyScalar(0.83).setY(0.55).normalize();
    return { position: target.clone().add(dir.multiplyScalar(distance)), target };
  }

  private previousPaths: string[] = [];

  private applySearch(): void {
    const found = this.search;
    const n = this.graph.notes.length;
    const state = (i: number) => (found === null ? 0 : found.has(i) ? 2 : 1);
    const match = this.planets?.geometry.getAttribute('aMatch') as InstancedBufferAttribute | undefined;
    if (match) {
      for (let i = 0; i < n; i++) match.array[i] = state(i);
      match.needsUpdate = true;
    }
    if (this.planetHalo) {
      const { halo, alphas, sizes } = this.planetHalo;
      for (let i = 0; i < n; i++) {
        const st = state(i);
        halo.alphas[i] = st === 1 ? alphas[i]! * 0.12 : st === 2 ? Math.max(alphas[i]!, 0.55) : alphas[i]!;
        halo.sizes[i] = st === 2 ? sizes[i]! * 1.5 : sizes[i]!;
      }
      halo.touch();
    }
    const dim = this.moonMesh?.geometry.getAttribute('aDim') as InstancedBufferAttribute | undefined;
    if (dim) {
      this.moons.forEach((m, k) => (dim.array[k] = state(m.note) === 1 ? 1 : 0));
      dim.needsUpdate = true;
    }
    if (this.routeColors) {
      const { attribute, base } = this.routeColors;
      const out = attribute.array as Float32Array;
      this.graph.links.forEach(([a, b], r) => {
        const both = found !== null && found.has(a) && found.has(b);
        const k = found === null ? 1 : both ? 2.5 : 0.12;
        for (let j = 0; j < 6; j++) out[r * 6 + j] = base[r * 6 + j]! * k;
      });
      attribute.needsUpdate = true;
    }
    this.container.dataset.searchMatches = found === null ? '' : String(found.size);
  }

  /** Seleciona o planeta e leva a câmera até ele. */
  focus(index: number): void {
    this.wake();
    const p = this.layout.notes[index];
    if (!p) return;
    this.select(index);
    this.autoRotate = false;
    const target = new Vector3(p.x, p.y, p.z);
    const offset = this.camera.position.clone().sub(this.controls.target);
    if (offset.lengthSq() < 1e-6) offset.set(0, 0.5, 1);
    this.flyTo(target.clone().add(offset.normalize().multiplyScalar(Math.max(10, p.size * 14))), target);
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
    this.tour = null;
    cancelAnimationFrame(this.frame);
    this.activity?.dispose();
    this.dropPersistent();
    this.ambient.clear();
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

  /**
   * Céu em duas camadas: o fundo distante e uma camada mais próxima, que se desloca mais quando a câmera se mexe
   * (paralaxe) e dá profundidade.
   */
  private backgroundStars(): Points[] {
    const layer = (
      seed: number,
      count: number,
      near: number,
      far: number,
      size: number,
      opacity: number,
      color: number,
    ) => {
      const rand = seeded(seed);
      const positions = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const u = rand() * 2 - 1;
        const phi = rand() * Math.PI * 2;
        const r = near + rand() * (far - near);
        const s = Math.sqrt(1 - u * u);
        positions.set([r * s * Math.cos(phi), r * u, r * s * Math.sin(phi)], i * 3);
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(positions, 3));
      const material = new PointsMaterial({
        color,
        size,
        sizeAttenuation: false,
        transparent: true,
        opacity,
        fog: false,
      });
      return new Points(geometry, material);
    };
    return [
      layer(7, this.profile.backgroundStars, 2200, 3700, 1.3, 0.7, 0xbfc3e6),
      layer(13, this.profile.nearStars, 700, 1500, 1.7, 0.45, 0xe6e9ff),
    ];
  }

  /** Movimento ambiente da cena atual (nada, com movimento reduzido ou sem notas). */
  private buildEffects(): void {
    if (this.options.reducedMotion || this.graph.notes.length === 0) {
      this.dropPersistent();
      this.container.dataset.ambient = 'off';
      return;
    }
    this.buildPersistent();
    const effects: Effect[] = [{ objects: [], animator: shaderClock(this.time) }];
    const flows = createFlows(this.graph, this.layout, this.profile, this.haloMaterial);
    const comets = createComets(this.graph, this.layout, () => this.profile, this.haloMaterial, seeded(23));
    if (flows) effects.push(flows);
    if (comets) effects.push(comets);
    this.container.dataset.flows = String(
      flows ? Math.min(this.graph.links.length, this.profile.limits.flowingRoutes) : 0,
    );
    this.container.dataset.comets = String(comets ? this.profile.limits.comets : 0);
    for (const e of effects) {
      if (e.objects.length > 0) this.content.add(...e.objects);
      this.effectRemovers.push(this.ambient.add(e.animator));
    }
    this.container.dataset.ambient = 'on';
  }

  /**
   * Naves ambientais e estrelas cadentes não recomeçam quando uma nota muda (a cena é refeita a cada alteração): só
   * recebem o layout novo. Trocar de modo recria as duas.
   */
  private buildPersistent(): void {
    if (this.persistent?.quality === this.profile.quality) {
      for (const e of this.persistent.effects) e.setLayout?.(this.layout);
      return;
    }
    this.dropPersistent();
    const effects: Effect[] = [createShootingStars(() => this.profile, seeded(17))];
    const ships = createShips(this.layout, this.profile, this.haloMaterial, seeded(29));
    if (ships) effects.push(ships);
    this.container.dataset.ships = String(ships ? this.profile.limits.ambientShips : 0);
    const removers: Array<() => void> = [];
    for (const e of effects) {
      this.scene.add(...e.objects);
      removers.push(this.ambient.add(e.animator));
    }
    this.persistent = { quality: this.profile.quality, effects, removers };
  }

  private dropPersistent(): void {
    if (!this.persistent) return;
    for (const remove of this.persistent.removers) remove();
    for (const e of this.persistent.effects)
      for (const o of e.objects) {
        this.scene.remove(o);
        const mesh = o as Mesh;
        mesh.geometry?.dispose();
        if (mesh.material && mesh.material !== this.haloMaterial) (mesh.material as Material).dispose();
      }
    this.persistent = null;
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
    const material = createNebulaMaterial(this.haloMaterial.uniforms.scale as { value: number }, this.time);
    const density = this.profile.nebulaDensity;
    const per = this.layout.systems.map((s) => Math.round(Math.min(400, 60 + s.count * 8) * density));
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
    halo.points.material = material;
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
    const match = new Float32Array(n);
    geometry.setAttribute('aColorA', new InstancedBufferAttribute(colorA, 3));
    geometry.setAttribute('aColorB', new InstancedBufferAttribute(colorB, 3));
    geometry.setAttribute('aParams', new InstancedBufferAttribute(params, 4));
    geometry.setAttribute('aAtmo', new InstancedBufferAttribute(atmo, 4));
    geometry.setAttribute('aGlow', new InstancedBufferAttribute(glow, 1));
    geometry.setAttribute('aMatch', new InstancedBufferAttribute(match, 1));

    const mesh = new InstancedMesh(geometry, createPlanetMaterial(this.time, this.rim), Math.max(1, n));
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
    this.planetHalo = { halo, alphas: halo.alphas.slice(), sizes: halo.sizes.slice() };
    this.content.add(mesh, halo.points);
    if (rings.length > 0) this.content.add(this.buildRings(rings, styles));
  }

  /** Luas dos anexos, até os limites do perfil (o modo Leve mostra menos por planeta). */
  private buildMoons(): void {
    this.moons = planMoons(this.graph, this.layout, this.profile);
    const mesh = createMoons(this.moons, this.layout, this.time, this.rim);
    this.moonMesh = mesh;
    if (mesh) this.content.add(mesh);
    this.container.dataset.moons = String(this.moons.length);
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
      // Conexões importantes brilham mais (a mistura é aditiva: cor mais forte = linha mais clara).
      const boost = isImportantRoute(this.graph, i) ? 2.2 : 1;
      c.set(this.layout.systems[pa.system]!.color).multiplyScalar(boost);
      colors.set([c.r, c.g, c.b], i * 6);
      c.set(this.layout.systems[pb.system]!.color).multiplyScalar(boost);
      colors.set([c.r, c.g, c.b], i * 6 + 3);
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    const colorAttribute = new BufferAttribute(colors, 3);
    geometry.setAttribute('color', colorAttribute);
    this.routeColors = { attribute: colorAttribute, base: colors.slice() };
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
    return haloBuffer(count, this.haloMaterial);
  }

  private clearContent(): void {
    for (const remove of this.effectRemovers) remove();
    this.effectRemovers = [];
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
    this.moons = [];
    this.moonMesh = null;
    this.planetHalo = null;
    this.routeColors = null;
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
    const pose = this.overviewPose();
    this.controls.target.copy(pose.target);
    this.camera.position.copy(pose.position);
    this.controls.update();
  }

  /** Posição da câmera que mostra a galáxia inteira. */
  private overviewPose(): { position: Vector3; target: Vector3 } {
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
    return { position: new Vector3(0, 0.55, 0.83).normalize().multiplyScalar(distance).add(center), target: center };
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

  /**
   * Lua sob o ponteiro. As luas andam no shader, então a posição é recalculada com a mesma conta e comparada na tela;
   * a área de clique tem um mínimo, porque de longe uma lua é um ponto.
   */
  private pickMoon(x: number, y: number): number | null {
    if (this.moons.length === 0) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const focal = rect.height / 2 / Math.tan((this.camera.fov * Math.PI) / 360);
    const v = new Vector3();
    let best: number | null = null;
    let bestDist = Infinity;
    this.moons.forEach((m, i) => {
      const center = this.layout.notes[m.note];
      if (!center) return;
      moonPosition(v, m, center, this.time.value);
      const depth = this.camera.position.distanceTo(v);
      v.project(this.camera);
      if (v.z > 1) return;
      const sx = rect.left + ((v.x + 1) / 2) * rect.width;
      const sy = rect.top + ((1 - v.y) / 2) * rect.height;
      const d = Math.hypot(sx - x, sy - y);
      const reach = Math.max(7, ((m.size * focal) / depth) * 1.6);
      if (d <= reach && d < bestDist) {
        best = i;
        bestDist = d;
      }
    });
    return best;
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
      const moon = this.pickMoon(e.clientX, e.clientY);
      const plan = moon === null ? undefined : this.moons[moon];
      if (plan) {
        this.focus(plan.note);
        this.callbacks.onMoon?.(plan.note, plan.name);
        return;
      }
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
      const t = Math.min(1, (performance.now() - this.fly.t0) / this.fly.duration);
      const k = easeInOut(t);
      this.camera.position.lerpVectors(this.fly.from, this.fly.to, k);
      this.controls.target.lerpVectors(this.fly.fromTarget, this.fly.toTarget, k);
      if (t === 1) {
        this.fly = null;
        this.settleUntil = performance.now() + SETTLE_MS;
        this.container.dataset.flying = 'false';
        // Chegou numa parada do tour: gira devagar em volta dela enquanto espera a próxima.
        if (this.tour && !this.options.reducedMotion) {
          this.controls.autoRotateSpeed = TOUR_SPIN;
          this.autoRotate = true;
        }
      }
    }
    if (this.tour && performance.now() >= this.tour.next) this.nextStop();
    // Movimento ambiente (giro automático e animações): no ritmo do perfil, mais lento ou parado sem foco, e nunca
    // com movimento reduzido. A interação (arrastar, voar até um planeta) continua desenhando em todo quadro.
    const now = performance.now();
    const animating = this.autoRotate || this.ambient.size > 0;
    const interval = animating
      ? ambientInterval({
          fps: this.autoRotate || this.ambient.fast ? this.profile.ambientFps : this.profile.idleFps,
          unfocusedFps: this.profile.unfocusedFps,
          focused: document.hasFocus(),
          reducedMotion: this.options.reducedMotion,
        })
      : null;
    const ambientDue = ambientFrameDue(now, this.lastAmbient, interval);
    let dt: number | null = null;
    if (ambientDue) {
      dt = Math.min(0.1, (now - this.lastAmbient) / 1000);
      this.lastAmbient = now;
      this.ambient.tick(dt, now);
      // Desenha mesmo se a última animação acabou agora: o quadro final (feixe apagado, pulso sumido) precisa aparecer.
      this.dirty = true;
    }
    // Com o amortecimento, cada passo do giro se espalha pelos quadros seguintes. Sem interação, a câmera só é
    // atualizada nos quadros do movimento ambiente; mexendo nela (ou logo depois), em todo quadro.
    const steering = this.interacting || now < this.settleUntil || this.fly !== null;
    this.controls.autoRotate = this.autoRotate && ambientDue;
    const moved = steering || ambientDue ? this.controls.update(dt) : false;

    // Parada (câmera quieta, ponteiro no mesmo lugar, nada mudou): não redesenha nem refaz o raycast.
    const pointerKey = this.pointer && !this.down ? `${this.pointer.x},${this.pointer.y}` : '';
    if (!moved && !this.dirty && !this.fly && pointerKey === this.lastPick) return;
    this.lastPick = pointerKey;
    this.dirty = false;

    const hovered = this.pointer && !this.down ? this.pick(this.pointer.x, this.pointer.y) : null;
    const hoveredMoon =
      hovered === null && this.pointer && !this.down ? this.pickMoon(this.pointer.x, this.pointer.y) : null;
    if (hovered !== this.hovered || hoveredMoon !== this.hoveredMoon) {
      const planetChanged = hovered !== this.hovered;
      this.hovered = hovered;
      this.hoveredMoon = hoveredMoon;
      this.renderer.domElement.style.cursor = hovered === null && hoveredMoon === null ? 'grab' : 'pointer';
      if (planetChanged && this.selected === null) this.updateHighlight();
    }
    this.updateLabels();
    this.renderer.render(this.scene, this.camera);
    this.rendered++;
    if (now - this.lastStats >= 1000) {
      this.lastStats = now;
      this.container.dataset.frames = String(this.rendered);
    }
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
    const moon = this.hoveredMoon === null ? undefined : this.moons[this.hoveredMoon];
    const center = moon ? this.layout.notes[moon.note] : undefined;
    if (moon && center) {
      const s = this.project(moonPosition(new Vector3(), moon, center, this.time.value).add(new Vector3(0, moon.size * 2, 0)));
      this.hoverLabel.classList.toggle('hidden', !s.visible);
      this.hoverLabel.textContent = `${MOON_LABELS[moonKind(moon.name)]}: ${moonName(moon.name)}`;
      this.hoverLabel.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
      return;
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
