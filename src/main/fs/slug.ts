const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** Remove acentos: decompõe (NFD) e descarta as marcas combinantes (\p{M}). */
function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '');
}

/** Nome reservado do Windows (CON, NUL, COM1…), inclusive com extensão (`con.txt`). */
export function isWindowsReservedName(name: string): boolean {
  return WINDOWS_RESERVED.test(name);
}

/**
 * Converte um nome livre em um trecho seguro para nome de pasta: sem acentos, minúsculo, só [a-z0-9-],
 * com no máximo `maxLength` caracteres. Nunca devolve vazio nem nome reservado.
 */
export function slugify(name: string, maxLength = 40): string {
  const base = stripAccents(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  if (!base) return 'workspace';
  return isWindowsReservedName(base) ? `${base}-ws` : base;
}

/** Comparação de nomes que ignora maiúsculas, acentos e espaços nas pontas ("Finanças" = "financas "). */
export function sameName(a: string, b: string): boolean {
  const norm = (s: string) => stripAccents(s.trim()).toLocaleLowerCase('pt-BR');
  return norm(a) === norm(b);
}
