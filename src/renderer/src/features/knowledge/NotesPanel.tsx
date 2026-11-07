import { ChevronRight, FilePlus, FileText, Folder, FolderPlus, Search } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import type { NoteTreeNode } from '@shared/knowledge';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { IconButton } from '@renderer/components/ui/IconButton';
import { useLayout } from '@renderer/app/shell/layout-store';
import { useActiveWorkspace } from '@renderer/features/workspaces/queries';
import { cn } from '@renderer/lib/cn';
import { NoteEditor } from './NoteEditor';
import { useCreateFolder, useCreateNote, useNoteTree } from './queries';

/** Aba "Nota" do painel lateral: navegador do segundo cérebro ou a nota aberta. */
export function NotesPanel() {
  const workspace = useActiveWorkspace();
  const opened = useLayout((s) => s.openedNote);
  // Nota de outro Workspace não abre aqui: o painel volta à lista do Workspace ativo.
  const openPath = opened && workspace && opened.workspaceId === workspace.id ? opened.path : null;
  if (!workspace) {
    return (
      <EmptyState
        className="flex-1"
        icon={<FileText size={18} />}
        title="Nenhuma nota aberta"
        description="Notas do segundo cérebro abrem aqui, ao lado da conversa."
      />
    );
  }
  return openPath ? (
    <NoteEditor key={`${workspace.id}:${openPath}`} workspaceId={workspace.id} path={openPath} />
  ) : (
    <NoteBrowser workspaceId={workspace.id} />
  );
}

type Creating = { kind: 'note' | 'folder'; parent: string } | null;

function NoteBrowser({ workspaceId }: { workspaceId: string }) {
  const tree = useNoteTree(workspaceId);
  const open = useLayout((s) => s.openNote);
  const openNote = (path: string) => open(workspaceId, path);
  const createNote = useCreateNote(workspaceId);
  const createFolder = useCreateFolder(workspaceId);
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState<Creating>(null);
  const [title, setTitle] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const filtered = useMemo(
    () => filterTree(tree.data?.children ?? [], filter.trim().toLowerCase()),
    [tree.data, filter],
  );
  const error = createNote.error ?? createFolder.error;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!creating || !title.trim()) return;
    try {
      if (creating.kind === 'note') {
        const { path } = await createNote.mutateAsync({ folder: creating.parent, title });
        openNote(path);
      } else {
        await createFolder.mutateAsync({ parent: creating.parent, title });
      }
      setCreating(null);
      setTitle('');
    } catch {
      // erro exibido abaixo
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="notes-browser">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <div className="relative flex-1">
          <Search size={13} className="absolute top-1/2 left-2 -translate-y-1/2 text-muted" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrar notas"
            aria-label="Filtrar notas"
            className="w-full rounded-md bg-surface-2 py-1 pr-2 pl-7 text-xs outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <IconButton label="Nova nota" className="size-7" onClick={() => setCreating({ kind: 'note', parent: '' })}>
          <FilePlus size={14} />
        </IconButton>
        <IconButton label="Nova pasta" className="size-7" onClick={() => setCreating({ kind: 'folder', parent: '' })}>
          <FolderPlus size={14} />
        </IconButton>
      </div>

      {creating && (
        <form onSubmit={submit} className="border-b border-border px-2 py-2">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setCreating(null)}
            placeholder={creating.kind === 'note' ? 'Nome da nota' : 'Nome da pasta'}
            aria-label={creating.kind === 'note' ? 'Nome da nota' : 'Nome da pasta'}
            className="w-full rounded-md border border-border bg-bg px-2 py-1 text-xs outline-none focus:border-accent"
          />
          <p className="mt-1 text-[11px] text-muted">
            {creating.parent ? `Em ${creating.parent}. ` : ''}Enter para criar, Esc para cancelar.
          </p>
        </form>
      )}
      {error && (
        <p role="alert" className="px-3 py-1 text-xs text-danger">
          {error.message}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
        {tree.isError && (
          <p role="alert" className="px-2 text-xs text-danger">
            {tree.error.message}
          </p>
        )}
        {tree.data && (tree.data.children?.length ?? 0) === 0 ? (
          <EmptyState
            className="h-full"
            icon={<FileText size={18} />}
            title="Nenhuma nota ainda"
            description="Crie a primeira ou peça ao Claude: “registra isso nas notas”."
          />
        ) : (
          <Tree
            nodes={filtered}
            depth={0}
            collapsed={filter ? new Set() : collapsed}
            onToggle={(p) =>
              setCollapsed((prev) => {
                const next = new Set(prev);
                if (next.has(p)) next.delete(p);
                else next.add(p);
                return next;
              })
            }
            onOpen={openNote}
            onNewNote={(parent) => setCreating({ kind: 'note', parent })}
          />
        )}
      </div>
    </div>
  );
}

function Tree({
  nodes,
  depth,
  collapsed,
  onToggle,
  onOpen,
  onNewNote,
}: {
  nodes: NoteTreeNode[];
  depth: number;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
  onNewNote: (parent: string) => void;
}) {
  return (
    <ul role={depth === 0 ? 'tree' : 'group'} aria-label={depth === 0 ? 'Notas' : undefined}>
      {nodes.map((n) =>
        n.type === 'folder' ? (
          <li key={n.path} role="treeitem" aria-expanded={!collapsed.has(n.path)} className="group/folder">
            <div className="relative flex items-center">
              <button
                type="button"
                onClick={() => onToggle(n.path)}
                className="flex w-full items-center gap-1 rounded-md py-1 pr-7 text-left text-xs text-muted hover:bg-surface-2 hover:text-text"
                style={{ paddingLeft: 6 + depth * 12 }}
              >
                <ChevronRight
                  size={12}
                  className={cn('shrink-0 transition-transform', !collapsed.has(n.path) && 'rotate-90')}
                />
                <Folder size={13} className="shrink-0" />
                <span className="truncate">{n.name}</span>
              </button>
              <IconButton
                label={`Nova nota em ${n.name}`}
                className="absolute right-0.5 size-6 opacity-0 group-hover/folder:opacity-100 focus-visible:opacity-100"
                onClick={() => onNewNote(n.path)}
              >
                <FilePlus size={12} />
              </IconButton>
            </div>
            {!collapsed.has(n.path) && (
              <Tree
                nodes={n.children ?? []}
                depth={depth + 1}
                collapsed={collapsed}
                onToggle={onToggle}
                onOpen={onOpen}
                onNewNote={onNewNote}
              />
            )}
          </li>
        ) : (
          <li key={n.path} role="treeitem">
            <button
              type="button"
              onClick={() => onOpen(n.path)}
              title={n.path}
              className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs hover:bg-surface-2"
              style={{ paddingLeft: 18 + depth * 12 }}
            >
              <FileText size={13} className="shrink-0 text-accent" />
              <span className="truncate">{n.name}</span>
            </button>
          </li>
        ),
      )}
    </ul>
  );
}

/** Mantém notas cujo caminho contém o filtro (e as pastas que levam até elas). */
function filterTree(nodes: NoteTreeNode[], q: string): NoteTreeNode[] {
  if (!q) return nodes;
  return nodes.flatMap((n) => {
    if (n.type === 'note') return n.path.toLowerCase().includes(q) ? [n] : [];
    const children = filterTree(n.children ?? [], q);
    return children.length ? [{ ...n, children }] : [];
  });
}
