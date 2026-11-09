import { ChevronRight, ClipboardPaste, Copy, ExternalLink, File, Folder, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import type { CodeEntry, CodeScope } from '@shared/code';
import { Button } from '@renderer/components/ui/Button';
import { Dialog } from '@renderer/components/ui/Dialog';
import { IconButton } from '@renderer/components/ui/IconButton';
import { useLayout } from '@renderer/app/shell/layout-store';
import { cn } from '@renderer/lib/cn';
import { useCodeList, useCopyEntries, useDeleteEntry, useImportPaths, useRenameEntry, useRevealEntry } from './queries';

interface Selected {
  path: string;
  type: CodeEntry['type'];
}

type Item = Selected & { name: string };

interface MenuState {
  x: number;
  y: number;
  /** Item sob o clique; vazio quando o clique foi no espaço livre (vale a raiz). */
  item: Item | null;
}

/** Estado compartilhado pela árvore inteira: o que está aberto, o que está selecionado e o que pode ser alterado. */
interface TreeUi {
  open: Set<string>;
  toggle: (path: string) => void;
  selected: Selected | null;
  select: (item: Selected) => void;
  ask: (item: Item) => void;
  menu: (e: MouseEvent, item: Item) => void;
  copy: (item: Selected) => void;
  rename: (item: Item) => void;
}

const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Árvore de arquivos da pasta do escopo. Clicar num arquivo abre o código dele. Como no Explorer do VS Code: copie
 * arquivos ou pastas no Windows e cole aqui (Ctrl+V) na pasta selecionada, ou arraste-os para cima de uma pasta; e
 * exclua com a lixeira ou a tecla Delete (o item vai para a Lixeira do sistema, nunca é apagado de vez). O botão
 * direito abre o menu: copiar, colar, renomear (F2), ver no Explorer e excluir.
 */
export function FileTree({ scope }: { scope: CodeScope }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Selected | null>(null);
  const [toDelete, setToDelete] = useState<Item | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [copied, setCopied] = useState<Selected[] | null>(null);
  const [toRename, setToRename] = useState<Item | null>(null);
  const [newName, setNewName] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const importPaths = useImportPaths(scope);
  const copyEntries = useCopyEntries(scope);
  const renameEntry = useRenameEntry(scope);
  const reveal = useRevealEntry(scope);
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
    menu: (e, item) => {
      e.preventDefault();
      e.stopPropagation();
      setSelected({ path: item.path, type: item.type });
      setMenu({ x: e.clientX, y: e.clientY, item });
    },
    copy: (item) => {
      setCopied([item]);
      setNotice({ kind: 'ok', text: 'Copiado. Cole numa pasta (botão direito ou Ctrl+V).' });
    },
    rename: (item) => {
      setNewName(item.name);
      setToRename(item);
    },
  };

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  /** Pasta que recebe a colagem: a selecionada, a pasta do arquivo selecionado ou a raiz. */
  const targetDir = (explicit?: string) =>
    explicit ?? (selected ? (selected.type === 'dir' ? selected.path : parentOf(selected.path)) : '');

  const pasted = (imported: string[], dir: string) => {
    if (dir) setOpen((prev) => new Set(prev).add(dir));
    setNotice({
      kind: 'ok',
      text: `${plural(imported.length, 'item colado', 'itens colados')}${dir ? ` em ${dir}` : ''}.`,
    });
  };

  async function bring(files: File[], dir: string) {
    const sources = window.nexus.pathsForFiles(files);
    if (sources.length === 0) {
      setNotice({ kind: 'error', text: 'Só consigo colar arquivos e pastas copiados do Explorer.' });
      return;
    }
    try {
      const { imported } = await importPaths.mutateAsync({ dir, sources });
      pasted(imported, dir);
    } catch (err) {
      setNotice({ kind: 'error', text: (err as Error).message });
    }
  }

  /** Cola o que foi copiado dentro da própria árvore (menu ou Ctrl+C). */
  async function pasteCopied(dir: string) {
    if (!copied) return;
    try {
      const { imported } = await copyEntries.mutateAsync({ dir, paths: copied.map((c) => c.path) });
      pasted(imported, dir);
    } catch (err) {
      setNotice({ kind: 'error', text: (err as Error).message });
    }
  }

  function onPaste(e: ClipboardEvent<HTMLDivElement>) {
    const files = [...e.clipboardData.files];
    e.preventDefault();
    if (files.length > 0) void bring(files, targetDir());
    else void pasteCopied(targetDir());
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

  const isOpenedCode = (path: string) =>
    openedCode !== null && openedCode.workspaceId === scope.workspaceId && openedCode.projectId === scope.projectId
      ? openedCode.path === path || openedCode.path.startsWith(`${path}/`)
      : false;

  async function confirmDelete() {
    const item = toDelete;
    if (!item) return;
    try {
      await remove.mutateAsync(item.path);
      if (selected && (selected.path === item.path || selected.path.startsWith(`${item.path}/`))) setSelected(null);
      if (isOpenedCode(item.path)) openCode(null);
      setNotice({ kind: 'ok', text: `"${item.name}" foi para a Lixeira.` });
    } catch (err) {
      setNotice({ kind: 'error', text: (err as Error).message });
    }
    setToDelete(null);
  }

  async function confirmRename() {
    const item = toRename;
    if (!item) return;
    try {
      const { path: next } = await renameEntry.mutateAsync({ path: item.path, name: newName });
      const moved = (p: string) =>
        p === item.path ? next : p.startsWith(`${item.path}/`) ? next + p.slice(item.path.length) : p;
      setSelected({ path: next, type: item.type });
      setOpen((prev) => new Set([...prev].map(moved)));
      setCopied((prev) => prev && prev.map((c) => ({ ...c, path: moved(c.path) })));
      if (openedCode && isOpenedCode(item.path)) openCode({ ...scope, path: moved(openedCode.path) });
    } catch (err) {
      setNotice({ kind: 'error', text: (err as Error).message });
    }
    setToRename(null);
  }

  return (
    <div
      tabIndex={-1}
      data-testid="file-tree"
      className="min-h-full pb-6 outline-none"
      onPaste={onPaste}
      onContextMenu={(e) => {
        e.preventDefault();
        setSelected(null);
        setMenu({ x: e.clientX, y: e.clientY, item: null });
      }}
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
      {menu && (
        <div
          role="menu"
          data-testid="tree-menu"
          className="fixed z-50 min-w-48 rounded-lg border border-border bg-surface p-1 text-xs shadow-xl"
          style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 190) }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {menu.item && (
            <MenuItem
              icon={Copy}
              label="Copiar"
              onPick={() => {
                ui.copy(menu.item!);
                setMenu(null);
              }}
            />
          )}
          <MenuItem
            icon={ClipboardPaste}
            label={menu.item?.type === 'dir' ? `Colar em ${menu.item.name}` : 'Colar'}
            disabled={!copied}
            onPick={() => {
              const dir = menu.item ? (menu.item.type === 'dir' ? menu.item.path : parentOf(menu.item.path)) : '';
              setMenu(null);
              void pasteCopied(dir);
            }}
          />
          {menu.item && (
            <MenuItem
              icon={Pencil}
              label="Renomear"
              onPick={() => {
                ui.rename(menu.item!);
                setMenu(null);
              }}
            />
          )}
          <MenuItem
            icon={ExternalLink}
            label="Ver no Explorer"
            onPick={() => {
              const path = menu.item?.path ?? '';
              setMenu(null);
              reveal.mutate(path, { onError: (err) => setNotice({ kind: 'error', text: err.message }) });
            }}
          />
          {menu.item && (
            <MenuItem
              icon={Trash2}
              label="Excluir"
              danger
              onPick={() => {
                ui.ask(menu.item!);
                setMenu(null);
              }}
            />
          )}
        </div>
      )}
      <Dialog open={toRename !== null} onClose={() => setToRename(null)} title={`Renomear: ${toRename?.name ?? ''}`}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void confirmRename();
          }}
        >
          <input
            autoFocus
            aria-label="Novo nome"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onFocus={(e) => {
              const dot = toRename?.type === 'file' ? e.target.value.lastIndexOf('.') : -1;
              e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length);
            }}
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus-visible:border-accent"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => setToRename(null)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={renameEntry.isPending || !newName.trim()}>
              Renomear
            </Button>
          </div>
        </form>
      </Dialog>
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

function MenuItem({
  icon: Icon,
  label,
  onPick,
  disabled,
  danger,
}: {
  icon: typeof Copy;
  label: string;
  onPick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onPick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-2 disabled:opacity-40 disabled:hover:bg-transparent',
        danger && 'text-danger',
      )}
    >
      <Icon size={13} className="shrink-0" />
      {label}
    </button>
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
    const item: Item = { path: entry.path, type: entry.type, name: entry.name };
    if (e.key === 'F2') {
      e.preventDefault();
      ui.rename(item);
    } else if (e.key === 'Delete') {
      e.preventDefault();
      ui.ask(item);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      ui.copy(item);
    }
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
              onContextMenu={(ev) => ui.menu(ev, { path: e.path, type: e.type, name: e.name })}
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
