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
  /** Quadros por segundo do movimento ambiente (giro automático e animações), com a janela em foco. */
  ambientFps: number;
  /** Idem, com a janela sem foco. 0 = o movimento ambiente para (a interação continua normal). */
  unfocusedFps: number;
  /** Estrelas do fundo. */
  backgroundStars: number;
  /** Fração da poeira das nebulosas (1 = toda). */
  nebulaDensity: number;
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
    unfocusedFps: 30,
    backgroundStars: 2500,
    nebulaDensity: 1,
    limits: { ambientShips: 6, activityShips: 4, comets: 4, flowingRoutes: 200, pulses: 24 },
  },
  leve: {
    quality: 'leve',
    maxPixelRatio: 1.5,
    ambientFps: 30,
    unfocusedFps: 0,
    backgroundStars: 1800,
    nebulaDensity: 0.65,
    limits: { ambientShips: 2, activityShips: 2, comets: 1, flowingRoutes: 40, pulses: 8 },
  },
};

export const DEFAULT_GALAXY_QUALITY: GalaxyQuality = 'leve';
