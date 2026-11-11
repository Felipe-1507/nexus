import { z } from 'zod';
import { mixHex } from './palette';

/**
 * Aparência dos planetas da galáxia. Cada nota ganha uma aparência aleatória, mas estável (sai do caminho da nota, então
 * o planeta é sempre o mesmo). O usuário pode trocar qualquer detalhe, e o que ele trocar fica guardado à parte.
 */

export const PLANET_KINDS = ['rochoso', 'gasoso', 'oceano', 'gelo', 'lava', 'deserto', 'metalico'] as const;
export type PlanetKind = (typeof PLANET_KINDS)[number];

export const PLANET_KIND_LABELS: Record<PlanetKind, string> = {
  rochoso: 'Rochoso',
  gasoso: 'Gasoso',
  oceano: 'Oceano',
  gelo: 'Gelo',
  lava: 'Lava',
  deserto: 'Deserto',
  metalico: 'Metálico',
};

export const DETAIL_MAX_CHARS = 300;

const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i, 'Use uma cor no formato #rrggbb');

/** Só o que o usuário mudou; o resto continua aleatório. */
export const planetOverrideSchema = z.object({
  kind: z.enum(PLANET_KINDS).optional(),
  /** Cor principal; as outras cores do planeta saem dela. */
  color: hexColor.optional(),
  ring: z.boolean().optional(),
  atmosphere: z.boolean().optional(),
  /** Muda o sorteio dos detalhes (faixas, manchas) sem trocar o tipo. */
  seed: z.number().int().min(0).max(999_999).optional(),
  /** Anotação livre sobre o planeta, mostrada no cartão. */
  detail: z.string().max(DETAIL_MAX_CHARS).optional(),
});
export type PlanetOverride = z.infer<typeof planetOverrideSchema>;

export interface PlanetStyle {
  kind: PlanetKind;
  /** Cor principal escolhida pelo usuário; `null` = a do sorteio. */
  color: string | null;
  ring: boolean;
  atmosphere: boolean;
  seed: number;
  detail: string;
}

/** Hash FNV-1a de 32 bits, mapeado para [0, 1). */
export function hash01(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4_294_967_296;
}

/** Pares de cores (A, B) por tipo: o sorteio escolhe um par. */
const KIND_COLORS: Record<PlanetKind, Array<[string, string]>> = {
  rochoso: [
    ['#8a7f76', '#4d4640'],
    ['#9c7b62', '#5a4231'],
    ['#7d8795', '#454d58'],
    ['#a08d7a', '#6b5b4b'],
  ],
  gasoso: [
    ['#e6c48a', '#b5763c'],
    ['#9ec4e6', '#4a78b0'],
    ['#e8a8a0', '#a8506a'],
    ['#c9b6ee', '#6f58b8'],
    ['#b9d9a7', '#5f9a58'],
  ],
  oceano: [
    ['#3f9a63', '#1c4f9e'],
    ['#5fb88a', '#1d6fb0'],
    ['#8fc06a', '#2a4fa0'],
  ],
  gelo: [
    ['#eaf6ff', '#9ec9ea'],
    ['#dff2f2', '#8fc4c9'],
    ['#f1eefc', '#b4acd8'],
  ],
  lava: [
    ['#3a2622', '#ff6a2b'],
    ['#2a1d2d', '#ff4f6a'],
    ['#33281c', '#ffb02b'],
  ],
  deserto: [
    ['#e0b575', '#a8693a'],
    ['#d9a27a', '#9a4f3b'],
    ['#e8cf94', '#b98a4e'],
  ],
  // a: painéis claros, b: casco escuro (as linhas acendem na cor de a).
  metalico: [
    ['#9fd4ff', '#3a4656'],
    ['#b6f0d0', '#36463f'],
    ['#ffd08a', '#4a4036'],
    ['#d7c4ff', '#3e3a52'],
  ],
};

function pick<T>(items: readonly T[], r: number): T {
  return items[Math.min(items.length - 1, Math.floor(r * items.length))]!;
}

/** Tipo por faixa de sorteio: rochosos são os mais comuns, lava os mais raros. */
function randomKind(r: number): PlanetKind {
  if (r < 0.3) return 'rochoso';
  if (r < 0.5) return 'gasoso';
  if (r < 0.65) return 'oceano';
  if (r < 0.77) return 'gelo';
  if (r < 0.87) return 'lava';
  return 'deserto';
}

/** Aparência sorteada para uma nota. O mesmo caminho dá sempre o mesmo planeta. */
export function generatePlanetStyle(notePath: string): PlanetStyle {
  const r = (salt: string) => hash01(`${salt}:${notePath}`);
  const kind = randomKind(r('kind'));
  const ringChance = kind === 'gasoso' ? 0.5 : kind === 'lava' ? 0.05 : 0.14;
  const atmosphereChance = kind === 'lava' ? 0.2 : kind === 'rochoso' || kind === 'deserto' ? 0.45 : 0.85;
  return {
    kind,
    color: null,
    ring: r('ring') < ringChance,
    atmosphere: r('atmo') < atmosphereChance,
    seed: Math.floor(r('seed') * 1000),
    detail: '',
  };
}

/** O que a nota tem e que muda a aparência automática do planeta (vem do índice, sem ler a nota de novo). */
export interface NoteTraits {
  chars: number;
  degree: number;
  codeBlocks?: number;
  images?: number;
}

/** Notas com pelo menos estes blocos de código viram planetas metálicos; acima destes caracteres, gigantes gasosos. */
export const AUTO_RULES = { codeBlocks: 2, giantChars: 8000, smallChars: 600, ringDegree: 6 } as const;
const MIDDLE_KINDS: PlanetKind[] = ['oceano', 'gelo', 'deserto', 'lava', 'rochoso'];

/**
 * Aparência automática: o tipo e os detalhes refletem a nota. Muito código: metálico. Extensa: gigante gasoso. Curta:
 * rochoso. Muitas conexões: anéis. Imagens: atmosfera luminosa. No meio-termo fica o sorteio estável (sem gasoso,
 * reservado às notas extensas), para a galáxia continuar variada. Cores e detalhes continuam sorteados pelo caminho.
 */
export function autoPlanetStyle(notePath: string, traits?: NoteTraits | null): PlanetStyle {
  const base = generatePlanetStyle(notePath);
  if (!traits) return base;
  let kind: PlanetKind;
  if ((traits.codeBlocks ?? 0) >= AUTO_RULES.codeBlocks) kind = 'metalico';
  else if (traits.chars >= AUTO_RULES.giantChars) kind = 'gasoso';
  else if (traits.chars < AUTO_RULES.smallChars) kind = 'rochoso';
  else kind = base.kind === 'gasoso' ? pick(MIDDLE_KINDS, hash01(`mid:${notePath}`)) : base.kind;
  return {
    ...base,
    kind,
    ring: traits.degree >= AUTO_RULES.ringDegree,
    atmosphere: (traits.images ?? 0) > 0 || base.atmosphere,
  };
}

/**
 * A aparência automática com o que o usuário trocou por cima: a escolha manual sempre vale, até ele voltar ao
 * automático (apagar a escolha).
 */
export function resolvePlanetStyle(
  notePath: string,
  override?: PlanetOverride | null,
  traits?: NoteTraits | null,
): PlanetStyle {
  const base = autoPlanetStyle(notePath, traits);
  if (!override) return base;
  return {
    kind: override.kind ?? base.kind,
    color: override.color ?? null,
    ring: override.ring ?? base.ring,
    atmosphere: override.atmosphere ?? base.atmosphere,
    seed: override.seed ?? base.seed,
    detail: override.detail ?? '',
  };
}

export interface PlanetColors {
  a: string;
  b: string;
  /** Cor do brilho da atmosfera e dos anéis. */
  glow: string;
}

/** Cores do planeta: as do sorteio do tipo, ou derivadas da cor que o usuário escolheu. */
export function planetColors(style: PlanetStyle): PlanetColors {
  if (style.color) {
    const a = style.kind === 'lava' ? mixHex(style.color, '#000000', 0.78) : style.color;
    const b =
      style.kind === 'lava' ? style.color : mixHex(style.color, style.kind === 'gelo' ? '#ffffff' : '#000000', 0.45);
    return { a, b, glow: mixHex(style.color, '#ffffff', 0.35) };
  }
  const [a, b] = pick(KIND_COLORS[style.kind], hash01(`pal:${style.kind}:${style.seed}`));
  return { a, b, glow: mixHex(style.kind === 'lava' ? b : a, '#ffffff', 0.3) };
}

/**
 * Tamanho do planeta: cresce com as conexões e, mais devagar, com o tamanho da nota (em caracteres). Uma nota com dez
 * vezes mais conteúdo fica visivelmente maior, mas sem passar do limite.
 */
export function planetSize(degree: number, chars = 0): number {
  const size = 0.55 + 0.2 * Math.sqrt(degree) + 0.28 * Math.log10(1 + chars / 300);
  return Math.min(size, PLANET_MAX_SIZE);
}
export const PLANET_MAX_SIZE = 2.6;
