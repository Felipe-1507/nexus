import type { GalaxyQuality } from '@shared/ipc-contract';

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
  /** Força do brilho de borda (Fresnel) dos planetas sem atmosfera própria. */
  rim: number;
  /** Intervalo médio entre estrelas cadentes e entre cometas, em segundos. */
  shootingStarEverySec: number;
  cometEverySec: number;
  /** Limites para os efeitos das próximas etapas (G2 em diante). */
  limits: {
    ambientShips: number;
    activityShips: number;
    comets: number;
    /** Rotas com fluxo de luz ao mesmo tempo. */
    flowingRoutes: number;
    /** Pulsos e brilhos temporários ao mesmo tempo. */
    pulses: number;
  };
}

export const GALAXY_PROFILES: Record<GalaxyQuality, GalaxyProfile> = {
  original: {
    quality: 'original',
    maxPixelRatio: 2,
    ambientFps: 60,
    idleFps: 60,
    unfocusedFps: 30,
    backgroundStars: 2500,
    nebulaDensity: 1,
    nearStars: 1400,
    rim: 1,
    shootingStarEverySec: 12,
    cometEverySec: 9,
    limits: { ambientShips: 6, activityShips: 4, comets: 4, flowingRoutes: 200, pulses: 24 },
  },
  leve: {
    quality: 'leve',
    maxPixelRatio: 1.5,
    ambientFps: 30,
    idleFps: 20,
    unfocusedFps: 0,
    backgroundStars: 1800,
    nebulaDensity: 0.65,
    nearStars: 450,
    rim: 0.6,
    shootingStarEverySec: 30,
    cometEverySec: 22,
    limits: { ambientShips: 2, activityShips: 2, comets: 1, flowingRoutes: 40, pulses: 8 },
  },
};

export const DEFAULT_GALAXY_QUALITY: GalaxyQuality = 'leve';
