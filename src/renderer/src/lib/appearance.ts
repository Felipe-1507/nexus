import { PALETTE } from '@shared/brand';
import { paletteCss, withAppearance, type Appearance, type Palette } from '@shared/palette';

/** Mesmo id do <style> que o main injeta na página com as cores escolhidas (main/window/protocol.ts). */
const STYLE_ID = 'nexus-appearance';

let current: Palette = PALETTE;
const listeners = new Set<(palette: Palette) => void>();

/** Paleta em uso: a da marca com a variação do escuro e a cor de destaque escolhidas. */
export function currentPalette(): Palette {
  return current;
}

/** Aplica as cores escolhidas na hora: atualiza as variáveis CSS e avisa quem desenha fora do CSS (o Monaco). */
export function applyAppearance(appearance: Appearance): void {
  current = withAppearance(PALETTE, appearance);
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = paletteCss(current);
  for (const listener of listeners) listener(current);
}

export function onPaletteChange(listener: (palette: Palette) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
