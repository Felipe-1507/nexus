import { watch, type FSWatcher } from 'chokidar';
import path from 'node:path';
import { CODE_WATCH_MAX_DIRS, type CodeEvent, type CodeScope } from '@shared/code';

const DEBOUNCE_MS = 250;
/** Em pasta de rede os eventos do sistema não chegam: lê a pasta de tempos em tempos. */
const NETWORK_POLL_MS = 2_000;

interface Watched {
  root: string;
  watcher: FSWatcher;
  /** Pastas observadas agora (relativas à raiz, com `/`; '' = a raiz). */
  dirs: Set<string>;
  /** Pastas com mudança ainda não avisada. */
  pending: Set<string>;
  timer: ReturnType<typeof setTimeout> | undefined;
}

const keyOf = (scope: CodeScope) => `${scope.workspaceId}:${scope.projectId ?? ''}`;

/**
 * Observa as pastas abertas na árvore de arquivos do visualizador de código e avisa quando a lista de uma delas muda
 * (por exemplo, ao copiar algo pelo Explorer). Só as pastas pedidas, e só os itens diretos de cada uma: um repositório
 * grande não vira milhares de observadores. Edições dentro de um arquivo não importam para a árvore e não geram aviso.
 */
export class CodeWatcher {
  private readonly scopes = new Map<string, Watched>();
  /** Pedidos em andamento por escopo: só o mais recente vale (a raiz é resolvida de forma assíncrona). */
  private readonly latest = new Map<string, number>();
  private seq = 0;

  constructor(
    private readonly deps: {
      resolveRoot: (scope: CodeScope) => Promise<string>;
      emit: (event: CodeEvent) => void;
      debounceMs?: number;
    },
  ) {}

  /** Define as pastas observadas do escopo (as que a árvore mostra abertas). Lista vazia = para de observar. */
  async set(scope: CodeScope, dirs: string[]): Promise<void> {
    const key = keyOf(scope);
    const id = ++this.seq;
    this.latest.set(key, id);
    if (dirs.length === 0) {
      this.stop(key);
      return;
    }
    let root: string;
    try {
      root = path.resolve(await this.deps.resolveRoot(scope));
    } catch {
      // Projeto sem pasta acessível ou removido: não há o que observar.
      this.stop(key);
      return;
    }
    if (this.latest.get(key) !== id) return;

    let entry = this.scopes.get(key);
    if (entry && entry.root !== root) {
      this.stop(key);
      entry = undefined;
    }
    const wanted = new Map<string, string>();
    for (const dir of dirs.slice(0, CODE_WATCH_MAX_DIRS)) {
      const abs = this.inside(root, dir);
      if (abs !== null) wanted.set(dir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''), abs);
    }
    if (!entry) {
      const watcher = watch([], {
        ignoreInitial: true,
        followSymlinks: false,
        // Só os itens diretos de cada pasta pedida.
        depth: 0,
        ignorePermissionErrors: true,
        usePolling: root.startsWith('\\\\'),
        interval: NETWORK_POLL_MS,
      });
      entry = { root, watcher, dirs: new Set(), pending: new Set(), timer: undefined };
      const current = entry;
      for (const event of ['add', 'unlink', 'addDir', 'unlinkDir'] as const) {
        watcher.on(event, (changed) => this.record(scope, current, changed));
      }
      watcher.on('error', () => {
        // Pasta removida ou sem acesso: a próxima atualização da árvore refaz a observação.
      });
      this.scopes.set(key, entry);
    }
    for (const [rel, abs] of wanted) {
      if (!entry.dirs.has(rel)) {
        entry.watcher.add(abs);
        entry.dirs.add(rel);
      }
    }
    for (const rel of [...entry.dirs]) {
      if (!wanted.has(rel)) {
        entry.watcher.unwatch(path.join(root, ...rel.split('/').filter(Boolean)));
        entry.dirs.delete(rel);
      }
    }
  }

  close(): void {
    for (const key of [...this.scopes.keys()]) this.stop(key);
    this.latest.clear();
  }

  private stop(key: string): void {
    const entry = this.scopes.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    void entry.watcher.close();
    this.scopes.delete(key);
  }

  /** Caminho absoluto da pasta pedida, se ficar dentro da raiz (sem `..` nem caminho absoluto); senão null. */
  private inside(root: string, dir: string): string | null {
    const parts = dir.replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.some((p) => p === '..' || p === '.' || /^[a-z]:$/i.test(p))) return null;
    return path.join(root, ...parts);
  }

  private record(scope: CodeScope, entry: Watched, changed: string): void {
    const rel = path.relative(entry.root, path.dirname(changed)).split(path.sep).filter(Boolean).join('/');
    entry.pending.add(rel);
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      const dirs = [...entry.pending];
      entry.pending.clear();
      this.deps.emit({ workspaceId: scope.workspaceId, projectId: scope.projectId, dirs });
    }, this.deps.debounceMs ?? DEBOUNCE_MS);
  }
}
