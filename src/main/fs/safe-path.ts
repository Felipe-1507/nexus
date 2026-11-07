import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolve `requested` (relativo) dentro de `root` e devolve o caminho absoluto, ou `null` se ele escapar da raiz
 * (`..`, caminho absoluto, outra unidade, UNC). Verificação só léxica; para arquivos do usuário use
 * `resolveInsideReal`, que também confere links e junctions.
 */
export function resolveInside(root: string, requested: string): string | null {
  if (requested.includes('\0')) return null;
  const base = path.resolve(root);
  const target = path.resolve(base, requested);
  const rel = path.relative(base, target);
  if (rel === '') return target;
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  return target;
}

/** `p` está dentro de `root`? Caminhos relativos partem do cwd. No Windows ignora maiúsculas (inclui UNC). */
export function isInside(root: string, p: string, cwd: string, platform: NodeJS.Platform): boolean {
  const lib = platform === 'win32' ? path.win32 : path.posix;
  const norm = (s: string) => (platform === 'win32' ? s.toLowerCase() : s);
  const base = norm(lib.resolve(root));
  const target = norm(lib.resolve(cwd, p));
  const rel = lib.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !lib.isAbsolute(rel));
}

/**
 * Como `resolveInside` (aceita `/` ou `\`), mas também confere o caminho real no disco: um link simbólico ou
 * junction dentro da raiz que aponte para fora é recusado. O trecho que ainda não existe (arquivo a criar) é
 * conferido pela pasta mais próxima que existe.
 */
export function resolveInsideReal(
  root: string,
  requested: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const target = resolveInside(root, requested.replace(/[\\/]+/g, path.sep));
  if (!target) return null;
  let existing = target;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return null;
    existing = parent;
  }
  const realRoot = fs.realpathSync.native(root);
  return isInside(realRoot, fs.realpathSync.native(existing), realRoot, platform) ? target : null;
}
