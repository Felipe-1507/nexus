import { isWindowsReservedName } from './slug';

const MAX_LENGTH = 100;

/**
 * Converte um título livre num nome de arquivo válido no Windows, mantendo acentos e espaços (como o Obsidian):
 * remove `<>:"/\|?*` e caracteres de controle, apara pontos e espaços nas pontas e evita nomes reservados.
 * Devolve `null` se não sobrar nada.
 */
export function sanitizeFileName(title: string): string | null {
  const cleaned = title
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, MAX_LENGTH)
    .trim();
  if (!cleaned) return null;
  return isWindowsReservedName(cleaned) ? `${cleaned}_` : cleaned;
}
