import { ChevronRight, File, Folder, Trash2 } from 'lucide-react';
import { useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import type { CodeEntry, CodeScope } from '@shared/code';
import { Button } from '@renderer/components/ui/Button';
import { Dialog } from '@renderer/components/ui/Dialog';
import { IconButton } from '@renderer/components/ui/IconButton';
import { useLayout } from '@renderer/app/shell/layout-store';
import { cn } from '@renderer/lib/cn';
import { useCodeList, useDeleteEntry, useImportPaths } from './queries';

interface Selected {
  path: string;
  type: CodeEntry['type'];
}

/** Estado compartilhado pela árvore inteira: o que está aberto, o que está selecionado e o que pode ser excluído. */
interface TreeUi {
  open: Set<string>;
  toggle: (path: string) => void;
  selected: Selected | null;
  select: (item: Selected) => void;
  ask: (item: Selected & { name: string }) => void;
}

const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Árvore de arquivos da pasta do escopo. Clicar num arquivo abre o código dele. Como no Explorer do VS Code: copie
 * arquivos ou pastas no Windows e cole aqui (Ctrl+V) na pasta selecionada, ou arraste-os para cima de uma pasta; e
 * exclua com a lixeira ou a tecla Delete (o item vai para a Lixeira do sistema, nunca é apagado de vez).
 */
export function FileTree({ scope }: { scope: CodeScope }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Selected | null>(null);
  const [toDelete, setToDelete] = useState<(Selected & { name: string }) | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const importPaths = useImportPaths(scope);
  const remove = useDeleteEntry(scope);
  const openedCode = useLayout((s) => s.openedCode);
  const openCode = useLayout((s) => s.openCode);

  const ui: TreeUi = {
    open,
    toggle: (path) =>
      setOpen((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      }),
    selected,
    select: setSelected,
    ask: setToDelete,
  };

  /** Pasta que recebe a colagem: a selecionada, a pasta do arquivo selecionado ou a raiz. */
  const targetDir = (explicit?: string) =>
    explicit ?? (selected ? (selected.type === 'dir' ? selected.path : parentOf(selected.path)) : '');

  async function bring(files: File[], dir: string) {
    const sources = window.nexus.pathsForFiles(files);
    if (sources.length === 0) {
      setNotice({ kind: 'error', text: 'Só consigo colar arquivos e pastas copiados do Explorer.' });
      return;
    }
    try {
      const { imported } = await importPaths.mutateAsync({ dir, sources });
      if (dir) setOpen((prev) => new Set(prev).add(dir));
      setNotice({
        kind: 'ok',
        text: `${plural(imported.length, 'item colado', 'itens colados')}${dir ? ` em ${dir}` : ''}.`,
      });
    } catch (err) {
      setNotice({ kind: 'error', text: (err as Error).message });
    }
  }

  function onPaste(e: ClipboardEvent<HTMLDivElement>) {
    const files = [...e.clipboardData.files];
    if (files.length === 0) return;
    e.preventDefault();
    void bring(files, targetDir());
  }

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    const files = [...e.dataTransfer.files];
    if (files.length === 0) return;
    e.preventDefault();
    // Solto em cima de uma pasta, vai para ela; solto em um arquivo, vai para a pasta dele; no vazio, para a raiz.
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-entry-path]');
    const dir = row
      ? row.dataset.entryType === 'dir'
        ? row.dataset.entryPath!
        : parentOf(row.dataset.entryPath!)
      : '';
    void bring(files, dir);
  }

  async function confirmDelete() {
    const item = toDelete;
    if (!item) return;
    try {
      await remove.mutateAsync(item.path);
      if (selected && (selected.path === item.path || selected.path.startsWith(`${item.path}/`))) setSelected(null);
      if (
        openedCode &&
        openedCode.workspaceId === scope.workspaceId &&
        openedCode.projectId === scope.projectId &&
        (openedCode.path === item.path || openedCode.path.startsWith(`${item.path}/`))
      ) {
        openCode(null);
      }
      setNotice({ kind: 'ok', text: `"${item.name}" foi para a Lixeira.` });
    } catch (err) {
      setNotice({ kind: 'error', text: (err as Error).message });
    }
    setToDelete(null);
  }

  return (
    <div
      tabIndex={-1}
      data-testid="file-tree"
      className="min-h-full pb-6 outline-none"
      onPaste={onPaste}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setSelected(null);
          e.currentTarget.focus();
        }
      }}
    >
      {notice && (
        <p
          role={notice.kind === 'error' ? 'alert' : 'status'}
          data-testid="tree-notice"
          className={cn('px-3 py-1 text-[11px]', notice.kind === 'error' ? 'text-danger' : 'text-muted')}
        >
          {notice.text}
        </p>
      )}
      <Dir scope={scope} dir="" depth={0} ui={ui} />
      <Dialog
        open={toDelete !== null}
        onClose={() => setToDelete(null)}
        title={`Mover para a Lixeira: ${toDelete?.name ?? ''}`}
        description={
          toDelete?.type === 'dir'
            ? 'A pasta e tudo o que há dentro dela vão para a Lixeira do Windows. Dá para restaurar de lá.'
            : 'O arquivo vai para a Lixeira do Windows. Dá para restaurar de lá.'
        }
      >
        <div className="flex justify-end gap-2">
          <Button onClick={() => setToDelete(null)}>Cancelar</Button>
          <Button variant="danger" onClick={() => void confirmDelete()} disabled={remove.isPending}>
            Mover para a Lixeira
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

/** Uma pasta da árvore; o conteúdo só é lido quando ela é aberta (pastas de rede podem ser lentas). */
function Dir({ scope, dir, depth, ui }: { scope: CodeScope; dir: string; depth: number; ui: TreeUi }) {
  const list = useCodeList(scope, dir);
  const openCode = useLayout((s) => s.openCode);
  const openedPath = useLayout((s) => {
    const o = s.openedCode;
    return o && o.workspaceId === scope.workspaceId && o.projectId === scope.projectId ? o.path : null;
  });

  if (list.isPending)
    return (
      <p className="px-3 py-1 text-[11px] text-muted" style={{ paddingLeft: 12 + depth * 12 }}>
        Carregando…
      </p>
    );
  if (list.isError) {
    return (
      <p role="alert" className="px-3 py-1 text-[11px] text-danger" style={{ paddingLeft: 12 + depth * 12 }}>
        {list.error.message}
      </p>
    );
  }

  const onKeyDown = (e: KeyboardEvent, entry: CodeEntry) => {
    if (e.key !== 'Delete') return;
    e.preventDefault();
    ui.ask({ path: entry.path, type: entry.type, name: entry.name });
  };

  return (
    <ul role={depth === 0 ? 'tree' : 'group'} aria-label={depth === 0 ? 'Arquivos' : undefined}>
      {list.data.map((e) => {
        const isDir = e.type === 'dir';
        const selected = ui.selected?.path === e.path;
        return (
          <li
            key={e.path}
            role="treeitem"
            aria-expanded={isDir ? ui.open.has(e.path) : undefined}
            aria-selected={isDir ? undefined : openedPath === e.path}
            className="group relative"
          >
            <button
              type="button"
              data-entry-path={e.path}
              data-entry-type={e.type}
              title={e.path}
              onClick={() => {
                ui.select({ path: e.path, type: e.type });
                if (isDir) ui.toggle(e.path);
                else openCode({ ...scope, path: e.path });
              }}
              onKeyDown={(ev) => onKeyDown(ev, e)}
              className={cn(
                'flex w-full items-center gap-1.5 rounded-md py-0.5 pr-7 text-left text-xs hover:bg-surface-2',
                'focus-visible:outline-2 focus-visible:outline-accent',
                isDir ? 'text-muted hover:text-text' : '',
                (selected || openedPath === e.path) && 'bg-surface-2 text-text',
              )}
              style={{ paddingLeft: isDir ? 6 + depth * 12 : 18 + depth * 12 }}
            >
              {isDir && (
                <ChevronRight
                  size={12}
                  className={cn('shrink-0 transition-transform', ui.open.has(e.path) && 'rotate-90')}
                />
              )}
              {isDir ? <Folder size={13} className="shrink-0" /> : <File size={13} className="shrink-0 text-muted" />}
              <span className="truncate">{e.name}</span>
            </button>
            <IconButton
              label={`Excluir ${e.name}`}
              className="absolute top-1/2 right-0.5 size-5 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              onClick={() => ui.ask({ path: e.path, type: e.type, name: e.name })}
            >
              <Trash2 size={11} />
            </IconButton>
            {isDir && ui.open.has(e.path) && <Dir scope={scope} dir={e.path} depth={depth + 1} ui={ui} />}
          </li>
        );
      })}
    </ul>
  );
}
