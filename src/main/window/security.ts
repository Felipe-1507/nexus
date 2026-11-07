import { shell, type Session, type WebContents } from 'electron';
import { buildCsp } from './csp';

function openExternalSafely(url: string): void {
  try {
    if (new URL(url).protocol === 'https:') void shell.openExternal(url);
  } catch {
    // URL malformada: ignora.
  }
}

/** Bloqueia navegação, novas janelas e webviews. Links https externos abrem no navegador padrão. */
export function hardenWebContents(contents: WebContents, isTrustedUrl: (url: string) => boolean): void {
  contents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) {
      event.preventDefault();
      openExternalSafely(url);
    }
  });
  contents.on('will-redirect', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

export function applySessionSecurity(session: Session, devServerOrigin?: string): void {
  // Câmera, microfone, notificações, geolocalização etc.: nada é concedido por enquanto.
  session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);

  // Em desenvolvimento o HTML vem do Vite: o CSP é aplicado por cabeçalho também ali.
  if (devServerOrigin) {
    const csp = buildCsp(devServerOrigin);
    session.webRequest.onHeadersReceived({ urls: [`${devServerOrigin}/*`] }, (details, callback) => {
      callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
    });
  }
}
