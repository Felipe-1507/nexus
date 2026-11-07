import { watch } from 'chokidar';
import path from 'node:path';

export type WatchFn = (dir: string, onChange: (paths: string[]) => void) => () => void;

const DEBOUNCE_MS = 150;

/**
 * Observa uma pasta e avisa, agrupado, quais caminhos relativos (com `/`) mudaram. Ignora ocultos (`.obsidian`,
 * `.git`, `.trash`) e não segue links. `usePolling` para pastas de rede, onde os eventos do sistema não chegam.
 */
export function createWatcher(options: { usePolling?: boolean } = {}): WatchFn {
  return (dir, onChange) => {
    const root = path.resolve(dir);
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const watcher = watch(root, {
      ignoreInitial: true,
      followSymlinks: false,
      usePolling: options.usePolling ?? false,
      interval: 2000,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      ignored: (p: string) =>
        path
          .relative(root, p)
          .split(path.sep)
          .some((part) => part.startsWith('.')),
    });
    const record = (p: string) => {
      pending.add(path.relative(root, p).split(path.sep).join('/'));
      clearTimeout(timer);
      timer = setTimeout(() => {
        const paths = [...pending];
        pending.clear();
        onChange(paths);
      }, DEBOUNCE_MS);
    };
    for (const event of ['add', 'change', 'unlink', 'addDir', 'unlinkDir'] as const) watcher.on(event, record);
    watcher.on('error', () => {
      // Pasta removida ou inacessível: o próximo acesso ao vault recria a observação.
    });
    return () => {
      clearTimeout(timer);
      void watcher.close();
    };
  };
}
