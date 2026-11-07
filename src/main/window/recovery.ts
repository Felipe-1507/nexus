import type { BrowserWindow, MessageBoxOptions, MessageBoxReturnValue } from 'electron';
import { BRAND } from '@shared/brand';

export interface RecoveryDeps {
  log: { warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
  showMessageBox: (win: BrowserWindow, options: MessageBoxOptions) => Promise<MessageBoxReturnValue>;
  now?: () => number;
}

/** Limita recarregamentos automáticos: se a interface cai sem parar, recarregar de novo só esconderia o problema. */
export function createReloadBudget(max: number, windowMs: number, now: () => number = Date.now) {
  const times: number[] = [];
  return {
    take(): boolean {
      const t = now();
      while (times.length > 0 && t - times[0]! > windowMs) times.shift();
      if (times.length >= max) return false;
      times.push(t);
      return true;
    },
  };
}

/**
 * Se o processo da interface cair, recarrega a janela (as conversas e os processos do Claude continuam no main).
 * Se ela travar, pergunta se o usuário quer esperar ou recarregar.
 */
export function watchWindowHealth(win: BrowserWindow, deps: RecoveryDeps): void {
  const budget = createReloadBudget(3, 60_000, deps.now);
  const contents = win.webContents;
  let asking = false;

  contents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || win.isDestroyed()) return;
    deps.log.error('A interface caiu', details);
    if (budget.take()) {
      contents.reload();
      return;
    }
    void deps
      .showMessageBox(win, {
        type: 'error',
        title: BRAND.productName,
        message: 'A interface parou de funcionar várias vezes seguidas.',
        detail: 'Os detalhes estão no log (Configurações → Pastas → Logs).',
        buttons: ['Recarregar', 'Fechar o app'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      .then(({ response }) => (response === 0 ? contents.reload() : win.close()));
  });

  contents.on('unresponsive', () => {
    if (asking || win.isDestroyed()) return;
    asking = true;
    deps.log.warn('A interface não está respondendo');
    void deps
      .showMessageBox(win, {
        type: 'warning',
        title: BRAND.productName,
        message: 'A janela não está respondendo.',
        detail: 'Você pode esperar ou recarregar a interface. Conversas em andamento não são perdidas.',
        buttons: ['Esperar', 'Recarregar'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })
      .then(({ response }) => {
        asking = false;
        if (response === 1 && !win.isDestroyed()) {
          contents.forcefullyCrashRenderer();
          contents.reload();
        }
      });
  });

  contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame) deps.log.error('A interface não carregou', { code, description, url });
  });
}
