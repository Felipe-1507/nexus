import { net, protocol } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveInside } from '../fs/safe-path';
import { buildCsp } from './csp';

export const APP_SCHEME = 'nexus';
export const APP_ORIGIN = `${APP_SCHEME}://app`;
/** Id do <style> com as cores do usuário (o mesmo que a interface atualiza). */
export const APPEARANCE_STYLE_ID = 'nexus-appearance';

/** Precisa rodar antes do `app.ready`. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

/**
 * Serve o renderer empacotado por `nexus://app/...` em vez de `file://`: origem própria, CSP via cabeçalho e
 * nenhum acesso a arquivos fora da pasta do renderer.
 */
export function handleAppProtocol(rendererDir: string, options: { headStyle?: () => string } = {}): void {
  const csp = buildCsp();
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'app') return new Response('Não encontrado', { status: 404 });
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const file = resolveInside(rendererDir, relative);
    if (!file) return new Response('Proibido', { status: 403 });
    const response = await net.fetch(pathToFileURL(file).toString());
    if (!response.ok) return response;
    const headers = new Headers(response.headers);
    headers.set('X-Content-Type-Options', 'nosniff');
    if (path.extname(file) !== '.html') return new Response(response.body, { status: response.status, headers });
    headers.set('Content-Security-Policy', csp);
    // As cores escolhidas pelo usuário entram na própria página: a primeira pintura já sai com elas, sem piscar a cor
    // padrão. A interface atualiza este mesmo <style> quando a escolha muda.
    const style = options.headStyle?.();
    if (!style) return new Response(response.body, { status: response.status, headers });
    const html = (await response.text()).replace(
      '</head>',
      () => `<style id="${APPEARANCE_STYLE_ID}">${style}</style></head>`,
    );
    headers.delete('Content-Length');
    return new Response(html, { status: response.status, headers });
  });
}
