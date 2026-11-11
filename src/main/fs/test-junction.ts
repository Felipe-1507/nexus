import fs from 'node:fs';

/**
 * Cria uma junction para os testes. Devolve `false` quando o Windows não deixa (EPERM/EACCES, sem permissão para
 * links), para o teste se declarar pulado em vez de falhar.
 */
export function tryJunction(target: string, link: string): boolean {
  try {
    fs.symlinkSync(target, link, 'junction');
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EPERM' || code === 'EACCES') return false;
    throw err;
  }
}
