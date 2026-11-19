/**
 * Prévia de uma nota para o cartão da galáxia (GE3): o começo do texto, sem a marcação do Markdown. Só trabalha com o
 * conteúdo que o Nexus já leu para abrir a nota; nada é resumido nem gerado.
 */

export const PREVIEW_MAX_CHARS = 360;

export function notePreview(content: string, max: number = PREVIEW_MAX_CHARS): string {
  let text = content.replace(/\r\n?/g, '\n');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  // Frontmatter (--- ... ---) no começo.
  text = text.replace(/^---\n[\s\S]*?\n---[ \t]*(\n|$)/, '');
  // Blocos de código: o conteúdo deles não ajuda a entender do que a nota trata.
  text = text.replace(/```[\s\S]*?(```|$)/g, ' ');
  const lines = text.split('\n').map((l) => l.trim());
  // O primeiro título já aparece no cartão.
  const firstContent = lines.findIndex((l) => l !== '');
  if (firstContent >= 0 && /^#{1,6}\s/.test(lines[firstContent]!)) lines.splice(firstContent, 1);
  const cleaned = lines
    .filter((l) => l !== '' && !/^(-{3,}|\*{3,}|_{3,})$/.test(l))
    .map((l) =>
      l
        .replace(/^#{1,6}\s+/, '')
        .replace(/^>\s?/, '')
        .replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, '')
        .replace(/^\d+[.)]\s+/, '')
        .replace(/!\[\[[^\]]*\]\]/g, '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
        .replace(/\[\[([^\]]*)\]\]/g, '$1')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/<[^>]+>/g, '')
        .replace(/(\*\*|__|~~)/g, '')
        .replace(/[*_`]/g, '')
        .trim(),
    )
    .filter((l) => l !== '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= max) return cleaned;
  // Corta numa palavra inteira.
  const cut = cleaned.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
