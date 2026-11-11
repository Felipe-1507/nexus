import { parse as parseYaml } from 'yaml';

export interface WikiLink {
  /** Nome da nota (sem `.md`, sem `#título`, sem `|apelido`). */
  target: string;
}

export interface ParsedNote {
  title: string;
  /** Primeira frase útil do corpo (para o índice que vai ao Claude). */
  summary: string;
  tags: string[];
  links: WikiLink[];
  aliases: string[];
  /** Blocos de código (```), para a aparência do planeta. */
  codeBlocks: number;
  /** Imagens incorporadas (`![[foto.png]]` ou `![](foto.png)`). */
  images: number;
  /** Outros arquivos incorporados (PDF, áudio...), sem repetição. */
  attachments: string[];
  /** Todos os arquivos incorporados que não são notas (imagens incluídas), sem repetir: as luas do planeta. */
  embeds: string[];
}

const SUMMARY_MAX = 140;
const ATTACHMENTS_MAX = 30;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

function asStrings(v: unknown): string[] {
  if (typeof v === 'string') return v.split(/[,\s]+/).filter(Boolean);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
}

/** Separa o frontmatter YAML (`---` no início) do corpo. YAML inválido é ignorado, como no Obsidian. */
export function splitFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(content);
  if (!match) return { data: {}, body: content };
  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = parseYaml(match[1]!);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
  } catch {
    // frontmatter inválido: tratado como vazio
  }
  return { data, body: content.slice(match[0].length) };
}

/** Remove blocos e trechos de código, onde `#` e `[[` não são tags nem links. */
function stripCode(text: string): string {
  return text.replace(/```[\s\S]*?(```|$)/g, '').replace(/`[^`\n]*`/g, '');
}

/**
 * Lê o que o Nexus precisa de uma nota no formato do Obsidian: título (frontmatter `title`, primeiro `# `, ou o
 * nome do arquivo), resumo (frontmatter `summary`/`description` ou o primeiro parágrafo), `#tags` e `[[links]]`.
 */
export function parseNote(content: string, fileName: string): ParsedNote {
  const { data, body } = splitFrontmatter(content);
  const prose = stripCode(body);

  const heading = /^#[ \t]+(.+?)[ \t#]*$/m.exec(body)?.[1]?.trim();
  const title = (typeof data.title === 'string' && data.title.trim()) || heading || fileName.replace(/\.md$/i, '');

  let summary =
    typeof data.summary === 'string' ? data.summary : typeof data.description === 'string' ? data.description : '';
  if (!summary) {
    const paragraph = prose
      .split(/\r?\n\s*\r?\n/)
      .map((p) => p.trim())
      .find((p) => p && !p.startsWith('#') && !p.startsWith('---'));
    summary = paragraph ?? '';
  }
  summary = summary
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, t: string, alias?: string) => alias ?? t)
    .replace(/[*_>`]/g, '')
    .replace(/^[-+]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (summary.length > SUMMARY_MAX) summary = `${summary.slice(0, SUMMARY_MAX - 1).trimEnd()}…`;

  const tags = new Set(asStrings(data.tags).map((t) => t.replace(/^#/, '')));
  for (const m of prose.matchAll(/(?:^|[\s(])#([\p{L}\p{N}_/-]*\p{L}[\p{L}\p{N}_/-]*)/gu)) tags.add(m[1]!);

  const links = new Map<string, WikiLink>();
  for (const m of prose.matchAll(/!?\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g)) {
    const target = m[1]!.trim().replace(/\.md$/i, '');
    if (target) links.set(target.toLowerCase(), { target });
  }

  // Arquivos incorporados (fora dos trechos de código): imagens contam à parte dos outros anexos.
  const embeds = new Set<string>();
  for (const m of prose.matchAll(/!\[\[([^\]|#\n]+)(?:[|#][^\]\n]*)?\]\]/g)) embeds.add(m[1]!.trim());
  for (const m of prose.matchAll(/!\[[^\]\n]*\]\(<?([^)>\s]+)>?(?:\s+"[^"]*")?\)/g)) {
    if (/^[a-z]+:\/\//i.test(m[1]!)) continue;
    try {
      embeds.add(decodeURIComponent(m[1]!).trim());
    } catch {
      embeds.add(m[1]!.trim());
    }
  }
  let images = 0;
  const attachments: string[] = [];
  const files: string[] = [];
  for (const e of embeds) {
    if (!/\.[a-z0-9]{2,5}$/i.test(e) || /\.md$/i.test(e)) continue;
    files.push(e);
    if (IMAGE_EXT.test(e)) images++;
    else attachments.push(e);
  }
  const fences = body.match(/^[ \t]*```/gm)?.length ?? 0;

  return {
    title,
    summary,
    tags: [...tags],
    links: [...links.values()],
    aliases: asStrings(data.aliases),
    codeBlocks: Math.ceil(fences / 2),
    images,
    attachments: attachments.slice(0, ATTACHMENTS_MAX),
    embeds: files.slice(0, ATTACHMENTS_MAX),
  };
}
