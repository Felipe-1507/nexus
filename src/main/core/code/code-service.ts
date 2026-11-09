import fs from 'node:fs/promises';
import path from 'node:path';
import { CODE_FILE_MAX_BYTES, type CodeEntry, type CodeFile, type CodeScope } from '@shared/code';
import { NexusError } from '@shared/ipc-result';
import { writeFileAtomic } from '../../fs/atomic';
import { isInside, resolveInsideReal } from '../../fs/safe-path';
import type { ProjectService } from '../projects/project-service';
import { META_DIR, type WorkspaceService } from '../workspaces/workspace-service';

/** Pastas que não ajudam a ler código e custam caro numa pasta de rede (e a pasta interna do Nexus). */
const HIDDEN = new Set(['.git', 'node_modules', '.next', 'dist', 'out', '.turbo', '.cache', META_DIR]);
const LIST_TIMEOUT_MS = 8_000;
const BINARY_PROBE_BYTES = 8_000;

async function withTimeout<T>(work: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new NexusError('VALIDATION', message)), LIST_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Visualizador de código: lista, lê e grava arquivos dentro da pasta do escopo (projeto ou Workspace), sempre
 * conferindo o caminho real (links e junctions não escapam da raiz). Binários e arquivos grandes não abrem.
 */
export class CodeService {
  constructor(
    private readonly deps: {
      workspaces: WorkspaceService;
      projects: Pick<ProjectService, 'get'>;
      platform?: NodeJS.Platform;
      /** Manda o item para a Lixeira do sistema (nada é apagado de vez). */
      trash?: (target: string) => Promise<void>;
      /** Mostra um item no Explorer do sistema. */
      reveal?: (target: string) => void;
      /** Pastas do próprio app (banco, preferências) que nunca podem ser copiadas para dentro de um projeto. */
      protectedDirs?: string[];
    },
  ) {}

  /** Pasta raiz do escopo. Um projeto só vale dentro do Workspace dono dele. */
  async root(scope: CodeScope): Promise<string> {
    const workspace = this.deps.workspaces.get(scope.workspaceId);
    if (!scope.projectId) return workspace.rootPath;
    const project = await this.deps.projects.get(scope.projectId);
    if (project.workspaceId !== workspace.id) throw new NexusError('NOT_FOUND', 'Projeto não encontrado.');
    if (project.status !== 'ok') throw new NexusError('VALIDATION', 'A pasta do projeto não está acessível.');
    return project.path;
  }

  async list(scope: CodeScope, dir: string): Promise<CodeEntry[]> {
    const root = await this.root(scope);
    const target = this.resolve(root, dir);
    const entries = await withTimeout(
      fs.readdir(target, { withFileTypes: true }),
      'A pasta não respondeu a tempo (rede?).',
    );
    const rel = (name: string) => (dir ? `${dir.replace(/\\/g, '/')}/${name}` : name);
    return entries
      .filter((e) => (e.isDirectory() || e.isFile()) && !HIDDEN.has(e.name))
      .map((e): CodeEntry => ({ name: e.name, path: rel(e.name), type: e.isDirectory() ? 'dir' : 'file', size: null }))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'pt-BR') : a.type === 'dir' ? -1 : 1));
  }

  async read(scope: CodeScope, file: string): Promise<CodeFile> {
    const root = await this.root(scope);
    const target = this.resolve(root, file);
    const stat = await withTimeout(fs.stat(target), 'O arquivo não respondeu a tempo (rede?).').catch((err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT')
        throw new NexusError('NOT_FOUND', 'Arquivo não encontrado.');
      throw err;
    });
    if (!stat.isFile()) throw new NexusError('VALIDATION', 'Não é um arquivo.');
    const base = { path: file, size: stat.size, mtimeMs: Math.floor(stat.mtimeMs) };
    if (stat.size > CODE_FILE_MAX_BYTES) return { ...base, content: null, reason: 'too_large' };
    const buffer = await fs.readFile(target);
    if (buffer.subarray(0, BINARY_PROBE_BYTES).includes(0)) return { ...base, content: null, reason: 'binary' };
    return { ...base, content: buffer.toString('utf8'), reason: null };
  }

  /** Pequenas edições do usuário. Recusa gravar por cima de uma alteração feita por fora (o Claude, o VS Code). */
  async write(scope: CodeScope, file: string, content: string, expectedMtimeMs: number): Promise<{ mtimeMs: number }> {
    if (Buffer.byteLength(content, 'utf8') > CODE_FILE_MAX_BYTES) {
      throw new NexusError('VALIDATION', 'O arquivo passa do limite de 2 MB.');
    }
    const root = await this.root(scope);
    const target = this.resolve(root, file);
    const current = Math.floor((await fs.stat(target)).mtimeMs);
    if (current !== expectedMtimeMs) {
      throw new NexusError('CONFLICT', 'O arquivo foi alterado fora do editor. Recarregue para ver a versão atual.');
    }
    writeFileAtomic(target, content);
    return { mtimeMs: Math.floor((await fs.stat(target)).mtimeMs) };
  }

  /**
   * Cola arquivos e pastas copiados do Explorer (ou arrastados) dentro de uma pasta do escopo. Nunca sobrescreve: se
   * o nome já existe, a cópia ganha " - cópia". Links simbólicos não são copiados. Devolve os caminhos criados.
   */
  async importPaths(
    scope: CodeScope,
    dir: string,
    sources: string[],
    /** Origem já dentro do escopo (copiada na árvore): não precisa da proteção das pastas do app. */
    trusted = false,
  ): Promise<{ imported: string[] }> {
    const root = await this.root(scope);
    const destDir = this.resolve(root, dir);
    if (!(await fs.stat(destDir).catch(() => null))?.isDirectory()) {
      throw new NexusError('VALIDATION', 'A pasta de destino não existe mais.');
    }
    const platform = this.deps.platform ?? process.platform;
    const imported: string[] = [];
    for (const raw of sources) {
      if (!path.isAbsolute(raw) || raw.includes('\0'))
        throw new NexusError('VALIDATION', 'Caminho de origem inválido.');
      const source = path.resolve(raw);
      const stat = await fs.lstat(source).catch(() => null);
      if (!stat) throw new NexusError('NOT_FOUND', `Não encontrei "${path.basename(source)}".`);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
        throw new NexusError('VALIDATION', `"${path.basename(source)}" não pode ser copiado (link ou item especial).`);
      }
      if (!trusted && (this.deps.protectedDirs ?? []).some((p) => isInside(p, source, p, platform))) {
        throw new NexusError('VALIDATION', 'Esta pasta pertence ao próprio app e não pode ser copiada.');
      }
      if (stat.isDirectory() && isInside(source, destDir, source, platform)) {
        throw new NexusError('VALIDATION', `Não dá para colar "${path.basename(source)}" dentro dela mesma.`);
      }
      const name = await this.freeName(destDir, path.basename(source), stat.isDirectory());
      const target = path.join(destDir, name);
      await fs.cp(source, target, {
        recursive: true,
        errorOnExist: true,
        force: false,
        filter: async (item) => !(await fs.lstat(item)).isSymbolicLink(),
      });
      imported.push([dir.replace(/\\/g, '/'), name].filter(Boolean).join('/'));
    }
    return { imported };
  }

  /** Cola dentro de `dir` itens que já estão no escopo (copiados na própria árvore). Mesmas regras de `importPaths`. */
  async copyEntries(scope: CodeScope, dir: string, files: string[]): Promise<{ imported: string[] }> {
    const root = await this.root(scope);
    return this.importPaths(
      scope,
      dir,
      files.map((f) => this.resolve(root, f)),
      true,
    );
  }

  /** Troca o nome de um arquivo ou pasta do escopo (ele continua na mesma pasta). Devolve o novo caminho. */
  async rename(scope: CodeScope, file: string, newName: string): Promise<{ path: string }> {
    const name = newName.trim();
    if (!name || name === '.' || name === '..' || /[<>:"/\\|?*\0]/.test(name) || /[. ]$/.test(name)) {
      throw new NexusError('VALIDATION', 'Nome inválido. Não use / \\ : * ? " < > | nem termine com ponto.');
    }
    const root = await this.root(scope);
    const source = this.resolve(root, file);
    if (path.resolve(source) === path.resolve(root))
      throw new NexusError('VALIDATION', 'A pasta raiz não pode ser renomeada.');
    if (!(await fs.lstat(source).catch(() => null))) throw new NexusError('NOT_FOUND', 'Arquivo não encontrado.');
    const target = path.join(path.dirname(source), name);
    if (path.basename(source) !== name && (await fs.lstat(target).catch(() => null))) {
      throw new NexusError('CONFLICT', `Já existe "${name}" nesta pasta.`);
    }
    if (path.basename(source) !== name) await fs.rename(source, target);
    const parent = file.replace(/\\/g, '/').split('/').slice(0, -1);
    return { path: [...parent, name].join('/') };
  }

  /** Mostra o item no Explorer do Windows (a raiz do escopo, quando `file` é vazio). */
  async reveal(scope: CodeScope, file: string): Promise<void> {
    if (!this.deps.reveal) throw new NexusError('VALIDATION', 'Abrir no Explorer não está disponível aqui.');
    const root = await this.root(scope);
    const target = file ? this.resolve(root, file) : root;
    if (!(await fs.lstat(target).catch(() => null))) throw new NexusError('NOT_FOUND', 'Arquivo não encontrado.');
    this.deps.reveal(target);
  }

  /** Move um arquivo ou pasta do escopo para a Lixeira. A raiz do escopo nunca pode ser removida. */
  async remove(scope: CodeScope, file: string): Promise<void> {
    if (!this.deps.trash) throw new NexusError('VALIDATION', 'Excluir não está disponível aqui.');
    const root = await this.root(scope);
    const target = this.resolve(root, file);
    if (path.resolve(target) === path.resolve(root))
      throw new NexusError('VALIDATION', 'A pasta raiz não pode ser excluída.');
    const stat = await fs.lstat(target).catch(() => null);
    if (!stat) throw new NexusError('NOT_FOUND', 'Arquivo não encontrado.');
    await this.deps.trash(target);
  }

  /** Primeiro nome livre na pasta: "a.txt", "a - cópia.txt", "a - cópia 2.txt"… */
  private async freeName(dir: string, name: string, isDir: boolean): Promise<string> {
    const ext = isDir ? '' : path.extname(name);
    const stem = name.slice(0, name.length - ext.length);
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? name : `${stem} - cópia${n > 2 ? ` ${n - 1}` : ''}${ext}`;
      if (!(await fs.lstat(path.join(dir, candidate)).catch(() => null))) return candidate;
    }
  }

  /** Endereço `vscode://` para abrir a pasta ou o arquivo no VS Code (só dentro do escopo). */
  async vscodeUrl(scope: CodeScope, file: string): Promise<string> {
    const root = await this.root(scope);
    const target = file ? this.resolve(root, file) : root;
    await fs.access(target).catch(() => {
      throw new NexusError('NOT_FOUND', 'Arquivo não encontrado.');
    });
    return `vscode://file/${encodeURI(target.split(path.sep).join('/')).replace(/#/g, '%23').replace(/\?/g, '%3F')}`;
  }

  /** Caminho absoluto de um arquivo do escopo informado como absoluto (ex.: vindo das alterações do Claude). */
  async relativeTo(scope: CodeScope, absolute: string): Promise<string | null> {
    const root = await this.root(scope);
    const rel = path.relative(root, absolute);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return this.resolve(root, rel) ? rel.split(path.sep).join('/') : null;
  }

  private resolve(root: string, rel: string): string {
    const target = resolveInsideReal(root, rel, this.deps.platform);
    if (!target) throw new NexusError('VALIDATION', 'Caminho fora da pasta.');
    return target;
  }
}
