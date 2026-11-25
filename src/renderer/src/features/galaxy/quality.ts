import type { GalaxyQuality } from '@shared/ipc-contract';
import type { PostFxSettings } from './post-fx';

/**
 * Perfis de qualidade da galáxia. O Modo Original é a referência (a galáxia como era antes dos perfis); o Leve gasta
 * menos GPU e CPU com o mesmo layout, as mesmas cores e as mesmas personalizações. Trocar de modo nunca muda a posição
 * de um planeta: só o que é desenhado e com que frequência.
 *
 * Os limites de naves, cometas e fluxos já ficam definidos aqui para as próximas etapas respeitarem os dois modos.
 */
export interface GalaxyProfile {
  quality: GalaxyQuality;
  /** Teto da densidade de pixels (telas de alta resolução). */
  maxPixelRatio: number;
  /** Quadros por segundo com movimento rápido (giro automático, cometas, estrelas cadentes), com a janela em foco. */
  ambientFps: number;
  /** Quadros por segundo quando só há movimento lento (rotação dos planetas, nebulosa, fluxos, naves). */
  idleFps: number;
  /** Idem, com a janela sem foco. 0 = o movimento ambiente para (a interação continua normal). */
  unfocusedFps: number;
  /** Estrelas do fundo. */
  backgroundStars: number;
  /** Fração da poeira das nebulosas (1 = toda). */
  nebulaDensity: number;
  /** Estrelas da camada próxima (dão profundidade: andam mais que as do fundo quando a câmera se mexe). */
  nearStars: number;
  /** Camadas de luz da corona do sol (1 a 3). */
  sunLayers: number;
  /** Força do brilho de borda (Fresnel) dos planetas sem atmosfera própria. */
  rim: number;
  /** Intervalo médio entre estrelas cadentes e entre cometas, em segundos. */
  shootingStarEverySec: number;
  cometEverySec: number;
  /** Núcleo Eclipse (estilo "Eclipse"): grãos de poeira, camadas de ruído do disco e segmentos do anel. */
  eclipse: { dust: number; periphery: number; octaves: number; segments: number; lensStars: number };
  /** Pós-processamento (bloom, cor de cinema, vinheta, grão). null = desenho direto. */
  post: PostFxSettings | null;
  /** Detalhe dos planetas: 0 = como sempre, 1 = Alta (relevo, terminador, dispersão), 2 = Ultra (mais relevo e ruído). */
  planetDetail: 0 | 1 | 2;
  /** Limites para os efeitos das próximas etapas (G2 em diante). */
  limits: {
    ambientShips: number;
    activityShips: number;
    comets: number;
    /** Rotas com fluxo de luz ao mesmo tempo. */
    flowingRoutes: number;
    /** Pulsos e brilhos temporários ao mesmo tempo. */
    pulses: number;
    /** Luas de anexos: no máximo por planeta e no total. */
    moonsPerPlanet: number;
    moons: number;
  };
}

const BASE: Record<'original' | 'leve', GalaxyProfile> = {
  original: {
    quality: 'original',
    maxPixelRatio: 2,
    ambientFps: 60,
    idleFps: 60,
    unfocusedFps: 30,
    backgroundStars: 2500,
    nebulaDensity: 1,
    sunLayers: 3,
    nearStars: 1400,
    rim: 1,
    post: null,
    planetDetail: 0,
    eclipse: { dust: 2600, periphery: 1400, octaves: 3, segments: 128, lensStars: 7000 },
    shootingStarEverySec: 12,
    cometEverySec: 9,
    limits: {
      ambientShips: 6,
      activityShips: 4,
      comets: 4,
      flowingRoutes: 200,
      pulses: 24,
      moonsPerPlanet: 6,
      moons: 600,
    },
  },
  leve: {
    quality: 'leve',
    maxPixelRatio: 1.5,
    ambientFps: 30,
    idleFps: 20,
    unfocusedFps: 0,
    backgroundStars: 1800,
    nebulaDensity: 0.65,
    sunLayers: 2,
    nearStars: 450,
    rim: 0.6,
    post: null,
    planetDetail: 0,
    eclipse: { dust: 700, periphery: 320, octaves: 2, segments: 64, lensStars: 2200 },
    shootingStarEverySec: 30,
    cometEverySec: 22,
    limits: {
      ambientShips: 2,
      activityShips: 2,
      comets: 1,
      flowingRoutes: 40,
      pulses: 8,
      moonsPerPlanet: 3,
      moons: 150,
    },
  },
};

/** Alta: a experiência Original com acabamento de cinema. Ultra: tudo no máximo, para placa de vídeo dedicada. */
const ALTA: GalaxyProfile = {
  ...BASE.original,
  quality: 'alta',
  planetDetail: 1,
  post: {
    bloom: { strength: 0.45, radius: 0.4, threshold: 0.85 },
    exposure: 0.95,
    vignette: 0.45,
    grain: 0.025,
    chroma: 0,
  },
};

const ULTRA: GalaxyProfile = {
  ...BASE.original,
  quality: 'ultra',
  planetDetail: 2,
  maxPixelRatio: 2.5,
  backgroundStars: 6000,
  nearStars: 3000,
  rim: 1.15,
  eclipse: { dust: 6000, periphery: 3200, octaves: 4, segments: 192, lensStars: 14000 },
  shootingStarEverySec: 8,
  cometEverySec: 7,
  post: {
    bloom: { strength: 0.6, radius: 0.5, threshold: 0.8 },
    exposure: 0.95,
    vignette: 0.6,
    grain: 0.035,
    chroma: 0.004,
  },
  limits: { ...BASE.original.limits, ambientShips: 10, comets: 6, pulses: 40 },
};

export const GALAXY_PROFILES: Record<GalaxyQuality, GalaxyProfile> = { ...BASE, alta: ALTA, ultra: ULTRA };

export const DEFAULT_GALAXY_QUALITY: GalaxyQuality = 'leve';
