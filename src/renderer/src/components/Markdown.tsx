import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { remarkNoteColors } from '@renderer/features/knowledge/editor/remark-note-colors';
import { fileTargetFromCode, fileTargetFromHref } from '@renderer/lib/file-links';
import { useFileLinkHandler } from '@renderer/features/chat/file-link-context';

const NOTE_SCHEME = 'nexus-note:';

/**
 * Transforma `[[Nota]]`, `[[Nota|apelido]]` e `[[Nota#seção]]` em links internos (fora de blocos de código) e tira
 * o frontmatter, como a visualização do Obsidian.
 */
export function prepareNoteMarkdown(content: string): string {
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, '');
  return body
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(
            /!?\[\[([^\]|#\n]+)(#[^\]|\n]*)?(?:\|([^\]\n]+))?\]\]/g,
            (_m, target: string, _h, alias?: string) => {
              const label = (alias ?? target).replace(/[[\]]/g, '');
              return `[${label}](${NOTE_SCHEME}${encodeURIComponent(target.trim())})`;
            },
          ),
    )
    .join('');
}

interface MarkdownProps {
  children: string;
  /** Com esta função, `[[links]]` viram links clicáveis para notas. */
  onNoteLink?: (target: string) => void;
}

/** Texto de um nó `code` do Markdown (só texto simples serve para reconhecer um caminho). */
function plainText(children: unknown): string | null {
  if (typeof children === 'string') return children;
  if (Array.isArray(children) && children.every((c) => typeof c === 'string')) return children.join('');
  return null;
}

/**
 * Markdown das respostas e das notas. HTML bruto não é renderizado (padrão do react-markdown) e links externos
 * abrem no navegador do sistema; o main só aceita https (ver window/security.ts).
 */
export function Markdown({ children, onNoteLink }: MarkdownProps) {
  const source = onNoteLink ? prepareNoteMarkdown(children) : children;
  // Dentro de uma conversa, links e caminhos de arquivo viram botões que abrem o arquivo (nota, código ou Explorer).
  const openFile = useFileLinkHandler();
  return (
    <div className="md">
      <ReactMarkdown
        // Cores de texto só valem em notas (onde o editor as grava); numa resposta do Claude, HTML continua sem efeito.
        remarkPlugins={onNoteLink ? [remarkGfm, remarkNoteColors] : [remarkGfm]}
        urlTransform={(url) =>
          url.startsWith(NOTE_SCHEME) || (openFile && fileTargetFromHref(url)) ? url : defaultUrlTransform(url)
        }
        components={{
          code: ({ className, children: text, ...rest }) => {
            const target = openFile && !className ? fileTargetFromCode(plainText(text) ?? '') : null;
            if (!target || !openFile)
              return (
                <code className={className} {...rest}>
                  {text}
                </code>
              );
            return (
              <code
                {...rest}
                role="link"
                tabIndex={0}
                className="file-link cursor-pointer underline decoration-dotted underline-offset-2 hover:decoration-solid"
                title="Abrir arquivo"
                onClick={() => void openFile(target)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    void openFile(target);
                  }
                }}
              >
                {text}
              </code>
            );
          },
          a: ({ href, children: label }) =>
            openFile && fileTargetFromHref(href) && !href?.startsWith(NOTE_SCHEME) ? (
              <a
                href="#"
                className="file-link"
                title={`Abrir arquivo: ${href}`}
                onClick={(e) => {
                  e.preventDefault();
                  void openFile(fileTargetFromHref(href)!);
                }}
              >
                {label}
              </a>
            ) : href?.startsWith(NOTE_SCHEME) && onNoteLink ? (
              <a
                href="#"
                className="wikilink"
                onClick={(e) => {
                  e.preventDefault();
                  onNoteLink(decodeURIComponent(href.slice(NOTE_SCHEME.length)));
                }}
              >
                {label}
              </a>
            ) : (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {label}
              </a>
            ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
