/** Extensões que contam como "arquivo" quando o caminho aparece sozinho, sem pasta (ex.: `config.txt`). */
const KNOWN_EXTENSIONS = new Set([
  'txt', 'md', 'json', 'yml', 'yaml', 'xml', 'csv', 'log', 'sql', 'html', 'css', 'scss', 'svg', 'env', 'ini', 'toml',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'vue', 'py', 'rb', 'php', 'java', 'cs', 'go', 'rs', 'sh', 'ps1', 'bat', 'prisma',
  'xlsx', 'xls', 'docx', 'doc', 'pptx', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'zip',
]); // prettier-ignore

const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/;
const UNC = /^\\\\[^\\/]+[\\/]/;
const FILE_URL = /^file:\/\//i;
const EXTERNAL = /^(https?:|mailto:|tel:|nexus-note:|#)/i;

/**
 * Destino de um link do Markdown que é um arquivo (caminho do Windows, de rede, `file://` ou relativo), ou `null` se for
 * um endereço da web, uma âncora ou um link de nota. Aqui basta parecer um caminho: o main confere se ele existe e se
 * está dentro das pastas permitidas.
 */
export function fileTargetFromHref(href: string | undefined): string | null {
  const target = href?.trim();
  if (!target || EXTERNAL.test(target)) return null;
  if (WINDOWS_ABSOLUTE.test(target) || UNC.test(target) || FILE_URL.test(target)) return target;
  // Outro esquema (javascript:, data:, ftp:…): nunca é arquivo.
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return null;
  return target;
}

/** Texto em código (`assim`) que parece um caminho de arquivo. Mais rígido que um link, para não marcar qualquer código. */
export function fileTargetFromCode(text: string): string | null {
  const t = text.trim();
  if (!t || /\s{2,}|\n/.test(t) || t.length > 400) return null;
  if (WINDOWS_ABSOLUTE.test(t) || UNC.test(t) || FILE_URL.test(t))
    return /\.[A-Za-z0-9]{1,8}(:\d+){0,2}$|[\\/]$/.test(t) ? t : null;
  const match = /^(?:\.{1,2}[\\/])?[\w.@()\- ]+(?:[\\/][\w.@()\- ]+)*\.([A-Za-z0-9]{1,8})(?::\d+){0,2}$/.exec(t);
  if (!match || !KNOWN_EXTENSIONS.has(match[1]!.toLowerCase())) return null;
  // `console.log` é código, não um arquivo de log: nome solto com .log não conta (com pasta, como `logs/app.log`, sim).
  if (!/[\\/]/.test(t) && match[1]!.toLowerCase() === 'log') return null;
  return t;
}
