import fs from 'node:fs';
import path from 'node:path';
import type { CodeScope } from '@shared/code';
import { NexusError } from '@shared/ipc-result';
import { isInside } from '../../fs/safe-path';
import { KNOWLEDGE_DIR, type WorkspaceService } from '../workspaces/workspace-service';
import type { CodeService } from './code-service';

/** Extensões que abrem no próprio Nexus (texto). O resto é mostrado no Explorer. */
export const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.jsonc', '.yml', '.yaml', '.toml', '.ini', '.env', '.xml', '.csv', '.tsv',
  '.log', '.sql', '.prisma', '.graphql', '.html', '.htm', '.css', '.scss', '.less', '.svg',
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.vue', '.svelte', '.py', '.rb', '.php', '.java', '.kt', '.cs',
  '.go', '.rs', '.c', '.h', '.cpp', '.hpp', '.sh', '.bash', '.ps1', '.bat', '.cmd', '.gitignore', '.editorconfig',
]); // prettier-ignore

export interface OpenResult {
  /** `note`: nota do vault; `code`: arquivo de texto do projeto; `revealed`: mostrado no Explorer. */
  action: 'note' | 'code' | 'revealed';
  /** Caminho relativo (nota: ao vault; código: à pasta do escopo). Nulo quando foi para o Explorer. */
  path: string | null;
}

/**
 * Tira o que o Claude costuma acrescentar a um caminho nas respostas: o prefixo `file:///`, codificação de URL
 * (`%20`), `<...>` em volta e o final `:12`, `:12:5` ou `#L12` (linha e coluna).
 */
export function cleanLinkTarget(raw: string): string {
  let t = raw.trim().replace(/^<|>$/g, '');
  if (/^file:\/\//i.test(t)) {
    t = t.replace(/^file:\/\/\/?/i, '');
    // `file://servidor/pasta` é um caminho de rede; `file:///C:/x` é local.
    if (!/^[A-Za-z]:/.test(t) && !t.startsWith('/')) t = `//${t}`;
  }
  if (/%[0-9A-Fa-f]{2}/.test(t)) {
    try {
      t = decodeURIComponent(t);
    } catch {
      // Não era codificação de URL: o caminho segue como está.
    }
  }
  return t.replace(/#L?\d+(?:-L?\d+)?$/i, '').replace(/(?::\d+){1,2}$/, '');
}

/**
 * Abre o arquivo citado numa resposta do Claude: nota do vault na aba Nota, arquivo de texto do projeto na aba Código,
 * qualquer outro no Explorer. Só vale dentro das pastas do projeto e do Workspace, e nunca executa nada.
 */
export class FileOpener {
  constructor(
    private readonly deps: {
      workspaces: Pick<WorkspaceService, 'get'>;
      code: Pick<CodeService, 'root' | 'relativeTo'>;
      reveal: (file: string) => void;
      openFolder: (dir: string) => Promise<string>;
      platform?: NodeJS.Platform;
    },
  ) {}

  async open(scope: CodeScope, rawTarget: string): Promise<OpenResult> {
    const platform = this.deps.platform ?? process.platform;
    const workspace = this.deps.workspaces.get(scope.workspaceId);
    const root = await this.deps.code.root(scope);
    const target = cleanLinkTarget(rawTarget);
    if (!target) throw new NexusError('VALIDATION', 'Link sem caminho.');
    const absolute = path.isAbsolute(target) ? path.normalize(target) : path.resolve(root, target);

    const inScope = [root, workspace.rootPath].some((dir) => isInside(dir, absolute, dir, platform));
    if (!inScope) {
      throw new NexusError('VALIDATION', 'Este arquivo está fora das pastas do projeto e do Workspace.');
    }
    const stat = await fs.promises.stat(absolute).catch(() => null);
    if (!stat) throw new NexusError('NOT_FOUND', `Arquivo não encontrado: ${path.basename(absolute)}`);

    if (stat.isDirectory()) {
      const error = await this.deps.openFolder(absolute);
      if (error) throw new NexusError('NOT_FOUND', `Não foi possível abrir a pasta: ${error}`);
      return { action: 'revealed', path: null };
    }

    const ext = path.extname(absolute).toLowerCase() || path.basename(absolute).toLowerCase();
    if (TEXT_EXTENSIONS.has(ext)) {
      const knowledgeDir = path.join(workspace.rootPath, KNOWLEDGE_DIR);
      if (ext === '.md' && isInside(knowledgeDir, absolute, knowledgeDir, platform)) {
        return { action: 'note', path: path.relative(knowledgeDir, absolute).split(path.sep).join('/') };
      }
      const relative = await this.deps.code.relativeTo(scope, absolute);
      if (relative) return { action: 'code', path: relative };
    }
    this.deps.reveal(absolute);
    return { action: 'revealed', path: null };
  }
}
