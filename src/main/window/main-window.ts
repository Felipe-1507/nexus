import { BrowserWindow } from 'electron';
import { BRAND } from '@shared/brand';
import { currentPalette, titleBarOverlay } from './theme';

export interface MainWindowOptions {
  preloadPath: string;
  url: string;
  devTools: boolean;
  /** Quem decide a hora de mostrar a janela pronta (ex.: depois da abertura animada). Padrão: na hora. */
  reveal?: (show: () => void) => void;
}

export function createMainWindow({ preloadPath, url, devTools, reveal }: MainWindowOptions): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: BRAND.productName,
    // Só em desenvolvimento; o app instalado usa o ícone do executável.
    ...(BRAND.icon ? { icon: BRAND.icon } : {}),
    backgroundColor: currentPalette().background,
    // Barra de título desenhada pelo app; os botões minimizar/maximizar/fechar continuam nativos.
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarOverlay(),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools,
    },
  });
  win.once('ready-to-show', () => {
    const show = () => {
      if (!win.isDestroyed()) win.show();
    };
    if (reveal) reveal(show);
    else show();
  });
  void win.loadURL(url);
  return win;
}
