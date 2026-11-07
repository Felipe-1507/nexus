import { BrowserWindow, nativeTheme } from 'electron';
import { PALETTE } from '@shared/brand';
import type { Palette } from '@shared/palette';
import type { Theme } from '@shared/ipc-contract';

/** Altura da barra de título própria (precisa bater com a do renderer). */
export const TITLE_BAR_HEIGHT = 40;

/** Paleta em uso: a da marca com a variação do escuro e a cor de destaque escolhidas pelo usuário. */
let palette: Palette = PALETTE;

export function activePalette(): Palette {
  return palette;
}

/** Troca a paleta e atualiza na hora o fundo e a barra de título das janelas abertas. */
export function applyPalette(next: Palette): void {
  palette = next;
  syncWindows();
}

/** Fundo da janela e barra de título nativa: as mesmas cores da interface. */
export function currentPalette() {
  const colors = nativeTheme.shouldUseDarkColors ? palette.dark : palette.light;
  return { background: colors.bg, titleBar: colors.titlebar, symbol: colors.text };
}

function syncWindows(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.setTitleBarOverlay(titleBarOverlay());
    win.setBackgroundColor(currentPalette().background);
  }
}

export function titleBarOverlay() {
  const p = currentPalette();
  return { color: p.titleBar, symbolColor: p.symbol, height: TITLE_BAR_HEIGHT };
}

/**
 * O tema é aplicado no `nativeTheme`. Assim o `prefers-color-scheme` do renderer, os menus nativos e os
 * botões da janela seguem a mesma escolha, sem lógica de tema duplicada no CSS.
 */
export function applyTheme(theme: Theme): void {
  nativeTheme.themeSource = theme;
}

/** Mantém os botões da janela e o fundo coerentes quando o tema muda (escolha do usuário ou do Windows). */
export function syncWindowsWithTheme(): void {
  nativeTheme.on('updated', syncWindows);
}
