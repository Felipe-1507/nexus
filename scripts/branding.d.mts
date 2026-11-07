export interface BrandingTheme {
  light?: Record<string, string>;
  dark?: Record<string, string>;
  galaxy?: string[];
}

export interface Branding {
  productName: string;
  appId: string;
  author: string | null;
  /** Cores que substituem as padrão (`src/shared/palette.ts`). */
  theme: BrandingTheme | null;
  /** Logo embutida como data URL. */
  logo: string | null;
  /** Caminho absoluto do ícone PNG da marca (null = ícone padrão). */
  icon: string | null;
}

export const LOCAL_BRANDING_DIR: string;
export const LOCAL_BRANDING_FILE: string;
export const DEFAULT_ICON: string;
export const DEFAULT_BRANDING: Readonly<Branding>;
export const THEME_TOKENS: readonly string[];
export function loadBranding(where?: { dir?: string; file?: string }): Branding;
export function artifactBase(branding: Branding): string;
