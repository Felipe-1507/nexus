import type { Branding } from '../../scripts/branding.mjs';
import { DEFAULT_PALETTE, mergePalette, type Palette } from './palette';

declare const __NEXUS_BRAND__: Branding;

/** Marca escolhida na compilação (`scripts/branding.mjs`): padrão "Nexus", ou a de `branding.local/`. */
export const BRAND: Branding = __NEXUS_BRAND__;

/** Cores da interface: as padrão com as trocas da marca. */
export const PALETTE: Palette = mergePalette(DEFAULT_PALETTE, BRAND.theme);
