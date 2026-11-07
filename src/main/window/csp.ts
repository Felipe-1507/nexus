/**
 * Content Security Policy do renderer. Em produção nada externo é permitido.
 * Em desenvolvimento o Vite precisa de script inline (preâmbulo do React Refresh) e WebSocket para o HMR.
 */
export function buildCsp(devServerOrigin?: string): string {
  const dev = Boolean(devServerOrigin);
  const ws = devServerOrigin?.replace(/^http/, 'ws');
  return [
    "default-src 'none'",
    `script-src 'self'${dev ? " 'unsafe-inline'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? ` ${ws}` : ''}`,
    "worker-src 'self' blob:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; ');
}
