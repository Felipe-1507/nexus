import { Menu, nativeImage, Tray, type BrowserWindow, type MessageBoxOptions } from 'electron';

/**
 * Segundo plano: fechar a janela (X, Alt+F4) não encerra o Nexus; ela só some e o ícone da barra de notificação
 * continua. As respostas do Claude seguem andando. Só fecha de verdade pelo ícone, depois de confirmar (ou quando o
 * Windows está desligando).
 */

/** Pergunta de "Fechar o Nexus": diz o que acontece com as respostas em andamento. */
export function quitConfirmation(productName: string, running: number): MessageBoxOptions {
  const warning =
    running === 0
      ? 'Nenhuma resposta do Claude está em andamento.'
      : running === 1
        ? 'Há 1 resposta do Claude em andamento: ela será interrompida.'
        : `Há ${running} respostas do Claude em andamento: elas serão interrompidas.`;
  return {
    type: 'question',
    title: `Fechar o ${productName}`,
    message: `Fechar o ${productName} de vez?`,
    detail: `${warning}\n\nSe preferir, ele pode continuar em segundo plano, no ícone ao lado do relógio.`,
    buttons: [`Fechar o ${productName}`, 'Continuar em segundo plano'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
}

export interface BackgroundDeps {
  /** Caminho do ícone (PNG) do aplicativo. */
  iconPath: string;
  productName: string;
  /** Respostas do Claude em andamento agora. */
  runningCount: () => number;
  /** Pergunta ao usuário (diálogo do sistema). */
  confirm: (options: MessageBoxOptions) => Promise<{ response: number }>;
  /** Encerra o app de verdade. */
  quit: () => void;
  /** Mostra a janela principal (e a recria, se ela não existir mais). */
  showWindow: () => void;
}

export interface BackgroundMode {
  /** Faz a janela esconder em vez de fechar. */
  attach: (win: BrowserWindow) => void;
  /** O app está encerrando de verdade (a janela pode fechar). */
  markQuitting: () => void;
  /** "Fechar o Nexus": confirma e, se o usuário quiser, encerra. Devolve se encerrou. */
  requestQuit: () => Promise<boolean>;
  isQuitting: () => boolean;
  /** A janela está escondida no segundo plano (e não ainda abrindo, nem fechada). */
  isHidden: () => boolean;
  dispose: () => void;
}

export function createBackgroundMode(deps: BackgroundDeps): BackgroundMode {
  let quitting = false;
  let noticeShown = false;
  let asking = false;
  let hidden = false;
  let tray: Tray | null = null;

  const ensureTray = (): Tray | null => {
    if (tray && !tray.isDestroyed()) return tray;
    try {
      const icon = nativeImage.createFromPath(deps.iconPath).resize({ width: 32, height: 32 });
      tray = new Tray(icon);
    } catch {
      // Sem ícone da bandeja (ambiente sem suporte): a janela não esconde, para o app não ficar inalcançável.
      tray = null;
      return null;
    }
    tray.setToolTip(deps.productName);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: `Abrir o ${deps.productName}`, click: () => deps.showWindow() },
        { type: 'separator' },
        { label: `Fechar o ${deps.productName}…`, click: () => void mode.requestQuit() },
      ]),
    );
    tray.on('click', () => deps.showWindow());
    tray.on('double-click', () => deps.showWindow());
    return tray;
  };

  const mode: BackgroundMode = {
    attach(win) {
      // O ícone existe desde o começo: assim o app nunca fica escondido sem um jeito de voltar.
      ensureTray();
      win.on('close', (event) => {
        if (quitting || !ensureTray()) return;
        event.preventDefault();
        hidden = true;
        win.hide();
        if (!noticeShown) {
          noticeShown = true;
          tray?.displayBalloon({
            iconType: 'info',
            title: `${deps.productName} continua em segundo plano`,
            content: 'Para abrir, clique no ícone ao lado do relógio. Para fechar de vez, use o menu do ícone.',
          });
        }
      });
      win.on('show', () => {
        hidden = false;
      });
      // O Windows está desligando ou o usuário está saindo da sessão: não pode impedir.
      win.on('session-end', () => {
        quitting = true;
      });
    },
    markQuitting() {
      quitting = true;
    },
    async requestQuit() {
      if (asking) return false;
      asking = true;
      try {
        const { response } = await deps.confirm(quitConfirmation(deps.productName, deps.runningCount()));
        if (response !== 0) return false;
        quitting = true;
        deps.quit();
        return true;
      } finally {
        asking = false;
      }
    },
    isQuitting: () => quitting,
    isHidden: () => hidden,
    dispose() {
      if (tray && !tray.isDestroyed()) tray.destroy();
      tray = null;
    },
  };
  return mode;
}
