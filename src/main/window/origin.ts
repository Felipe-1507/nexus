/**
 * Origem no formato `protocolo//host`. Não usa `URL.origin` porque, para esquemas próprios como `nexus://`,
 * o Node devolve `"null"`.
 */
export function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.host ? `${u.protocol}//${u.host}` : null;
  } catch {
    return null;
  }
}

/** Origens de onde o renderer pode ser carregado (app empacotado ou servidor de desenvolvimento). */
export function createOriginGuard(allowedOrigins: string[]) {
  return (url: string | undefined): boolean => {
    if (!url) return false;
    const origin = originOf(url);
    return origin !== null && allowedOrigins.includes(origin);
  };
}
