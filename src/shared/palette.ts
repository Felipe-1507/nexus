/**
 * Cores da interface: uma fonte só para o CSS (gerado na compilação), a barra de título nativa e o fundo da janela
 * (main) e o editor de código (Monaco). A marca pode trocar qualquer cor (`branding.local/theme.json`); o que ela não
 * definir vem daqui.
 *
 * Módulo puro: também é usado pela configuração do electron-vite, onde a marca ainda não existe como constante.
 */

export const PALETTE_TOKENS = [
  'bg',
  'surface',
  'surface-2',
  'titlebar',
  'border',
  'text',
  'text-muted',
  'accent',
  'accent-soft',
  'ok',
  'danger',
] as const;
export type PaletteToken = (typeof PALETTE_TOKENS)[number];
export type PaletteColors = Record<PaletteToken, string>;

export interface Palette {
  light: PaletteColors;
  dark: PaletteColors;
  /** Cores dos sistemas solares da galáxia (o núcleo usa a primeira). */
  galaxy: string[];
}

export interface PaletteOverride {
  light?: Partial<PaletteColors>;
  dark?: Partial<PaletteColors>;
  galaxy?: string[];
}

export const DEFAULT_PALETTE: Palette = {
  light: {
    bg: '#f7f7fb',
    surface: '#ffffff',
    'surface-2': '#f0f0f6',
    titlebar: '#f0f0f6',
    border: '#e3e3ec',
    text: '#16161d',
    'text-muted': '#6b6b7b',
    accent: '#6d5cff',
    'accent-soft': '#6d5cff1f',
    ok: '#1f9d55',
    danger: '#d64545',
  },
  dark: {
    bg: '#0b0b12',
    surface: '#111119',
    'surface-2': '#1a1a26',
    titlebar: '#0f0f17',
    border: '#23232f',
    text: '#ececf3',
    'text-muted': '#8d8da3',
    accent: '#8b7dff',
    'accent-soft': '#8b7dff26',
    ok: '#3ccf7c',
    danger: '#ff6b6b',
  },
  galaxy: ['#ffe3a3', '#8b7dff', '#5cc8ff', '#ff7ac6', '#ffc25c', '#6ee7a8', '#ff8a65', '#7aa2ff', '#c792ea'],
};

export function mergePalette(base: Palette, override: PaletteOverride | null | undefined): Palette {
  return {
    light: { ...base.light, ...override?.light },
    dark: { ...base.dark, ...override?.dark },
    galaxy: override?.galaxy?.length ? [...override.galaxy] : [...base.galaxy],
  };
}

const block = (colors: PaletteColors) => PALETTE_TOKENS.map((token) => `  --${token}: ${colors[token]};`).join('\n');

/**
 * Variáveis CSS dos dois temas. O tema escolhido é aplicado pelo main no `nativeTheme`, que controla o
 * `prefers-color-scheme`; por isso basta a media query.
 */
export function paletteCss(palette: Palette): string {
  return [
    `:root {\n${block(palette.light)}\n  color-scheme: light;\n}`,
    `@media (prefers-color-scheme: dark) {\n  :root {\n${block(palette.dark).replace(/^/gm, '  ')}\n    color-scheme: dark;\n  }\n}`,
  ].join('\n\n');
}

/**
 * Variações do tema escuro que o usuário escolhe em Configurações. "Padrão" é o escuro da marca (ou o do Nexus); as
 * outras trocam fundo, superfícies, bordas e textos, e mantêm a cor de destaque.
 */
export const DARK_VARIANTS = {
  padrao: { label: 'Padrão', colors: {} },
  'azul-noite': {
    label: 'Azul-noite',
    colors: {
      bg: '#070d1a',
      surface: '#0c1426',
      'surface-2': '#13203a',
      titlebar: '#0a1120',
      border: '#1c2b4a',
      text: '#e6edf9',
      'text-muted': '#8ea0c2',
    },
  },
  grafite: {
    label: 'Grafite',
    colors: {
      bg: '#0e0e10',
      surface: '#161618',
      'surface-2': '#1f1f23',
      titlebar: '#121214',
      border: '#2a2a2f',
      text: '#ececee',
      'text-muted': '#8e8e96',
    },
  },
  preto: {
    label: 'Preto',
    colors: {
      bg: '#000000',
      surface: '#0a0a0a',
      'surface-2': '#151515',
      titlebar: '#000000',
      border: '#232323',
      text: '#f2f2f2',
      'text-muted': '#8a8a8a',
    },
  },
} satisfies Record<string, { label: string; colors: Partial<PaletteColors> }>;
export type DarkVariant = keyof typeof DARK_VARIANTS;
export const DARK_VARIANT_IDS = Object.keys(DARK_VARIANTS) as [DarkVariant, ...DarkVariant[]];

/** Cores de destaque prontas. `null` = a da marca (ou a do Nexus). */
export const ACCENT_PRESETS: Array<{ label: string; hex: string | null }> = [
  { label: 'Padrão', hex: null },
  { label: 'Azul', hex: '#4f8cff' },
  { label: 'Turquesa', hex: '#2dd4bf' },
  { label: 'Verde', hex: '#34d399' },
  { label: 'Âmbar', hex: '#f5b041' },
  { label: 'Laranja', hex: '#fb7c4a' },
  { label: 'Rosa', hex: '#f472b6' },
];

export interface Appearance {
  darkVariant: DarkVariant;
  /** `#rrggbb`, ou `null` para a cor da marca. */
  accent: string | null;
}

export const DEFAULT_APPEARANCE: Appearance = { darkVariant: 'padrao', accent: null };

/** Mistura duas cores `#rrggbb` (t = 0 → a, t = 1 → b). */
export function mixHex(a: string, b: string, t: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const out = [0, 1, 2].map((i) => Math.round(channel(a, i) * (1 - t) + channel(b, i) * t));
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Paleta final: a da marca com a variação do escuro e a cor de destaque escolhidas pelo usuário. No tema claro, o
 * destaque fica um pouco mais escuro, para o texto branco dos botões continuar legível.
 */
export function withAppearance(base: Palette, appearance: Appearance): Palette {
  const dark = { ...base.dark, ...(DARK_VARIANTS[appearance.darkVariant]?.colors ?? {}) };
  const light = { ...base.light };
  if (appearance.accent) {
    dark.accent = appearance.accent;
    dark['accent-soft'] = `${appearance.accent}26`;
    light.accent = mixHex(appearance.accent, '#000000', 0.15);
    light['accent-soft'] = `${appearance.accent}1f`;
  }
  return { light, dark, galaxy: base.galaxy };
}
