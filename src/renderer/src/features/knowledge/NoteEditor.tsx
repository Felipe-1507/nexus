import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Eye, Link2, Pencil, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { NexusError } from '@shared/ipc-result';
import type { EditorView } from '@codemirror/view';
import { CodeEditor } from '@renderer/components/CodeEditor';
import { Markdown } from '@renderer/components/Markdown';
import { Button } from '@renderer/components/ui/Button';
import { IconButton } from '@renderer/components/ui/IconButton';
import { useLayout } from '@renderer/app/shell/layout-store';
import { invoke } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { NoteToolbar } from './editor/NoteToolbar';
import { noteKeys, useNote, useNoteLinks, useRenameNote, useTrashNote } from './queries';

type Status = 'saved' | 'dirty' | 'saving' | 'conflict' | { error: string };
const AUTOSAVE_MS = 800;

/**
 * Nota aberta ao lado da conversa: visualização com [[links]] clicáveis ou edição (CodeMirror), salvamento
 * automático e "Mencionada em". Se a nota mudar por fora (o Claude editou), recarrega sozinha quando não há
 * alterações locais; se houver, avisa e deixa o usuário decidir.
 */
export function NoteEditor({ workspaceId, path }: { workspaceId: string; path: string }) {
  const queryClient = useQueryClient();
  const note = useNote(workspaceId, path);
  const links = useNoteLinks(workspaceId, path);
  const open = useLayout((s) => s.openNote);
  const openNote = (target: string | null) => open(workspaceId, target);
  const rename = useRenameNote(workspaceId);
  const trash = useTrashNote(workspaceId);
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [content, setContent] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('saved');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [editorView, setEditorView] = useState<EditorView | null>(null);
  const mtime = useRef(0);
  const pending = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  // Primeira leitura e recargas vindas de fora.
  useEffect(() => {
    if (!note.data) return;
    if (pending.current === null && status !== 'conflict') {
      mtime.current = note.data.mtimeMs;
      setContent(note.data.content);
    } else if (note.data.mtimeMs !== mtime.current) {
      setStatus('conflict');
    }
    // `status` fora das dependências: só reage a uma versão nova da nota.
  }, [note.data]);

  const save = useCallback(async () => {
    window.clearTimeout(timer.current);
    const text = pending.current;
    if (text === null) return;
    pending.current = null;
    setStatus('saving');
    try {
      const { mtimeMs } = await invoke('knowledge:write', {
        workspaceId,
        path,
        content: text,
        expectedMtimeMs: mtime.current,
      });
      mtime.current = mtimeMs;
      queryClient.setQueryData(noteKeys.note(workspaceId, path), { path, content: text, mtimeMs });
      setStatus(pending.current === null ? 'saved' : 'dirty');
    } catch (err) {
      pending.current ??= text;
      const e = err as NexusError;
      setStatus(e.code === 'CONFLICT' ? 'conflict' : { error: e.message });
    }
  }, [queryClient, workspaceId, path]);

  // Ao fechar a nota, grava o que faltou.
  useEffect(
    () => () => {
      if (pending.current !== null) void save();
    },
    [save],
  );

  function onChange(text: string) {
    setContent(text);
    pending.current = text;
    if (status === 'conflict') return;
    setStatus('dirty');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), AUTOSAVE_MS);
  }

  async function reloadFromDisk() {
    const fresh = await invoke('knowledge:read', { workspaceId, path });
    pending.current = null;
    mtime.current = fresh.mtimeMs;
    setContent(fresh.content);
    setStatus('saved');
  }

  async function keepMine() {
    const fresh = await invoke('knowledge:read', { workspaceId, path });
    mtime.current = fresh.mtimeMs;
    pending.current = content;
    await save();
  }

  async function followLink(target: string) {
    const { path: resolved } = await invoke('knowledge:resolve', { workspaceId, target, from: path });
    if (resolved) return openNote(resolved);
    // Link para nota que ainda não existe: cria, como o Obsidian.
    const folder = target.includes('/') ? target.split('/').slice(0, -1).join('/') : '';
    const title = target.split('/').pop()!;
    try {
      const created = await invoke('knowledge:create', { workspaceId, folder, title });
      void queryClient.invalidateQueries({ queryKey: noteKeys.tree(workspaceId) });
      openNote(created.path);
    } catch {
      // pasta do link não existe: cria na raiz
      const created = await invoke('knowledge:create', { workspaceId, folder: '', title });
      void queryClient.invalidateQueries({ queryKey: noteKeys.tree(workspaceId) });
      openNote(created.path);
    }
  }

  const name = path.split('/').pop()!.replace(/\.md$/i, '');

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="note-editor">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <IconButton label="Voltar às notas" className="size-7" onClick={() => openNote(null)}>
          <ArrowLeft size={14} />
        </IconButton>
        {renaming !== null ? (
          <form
            className="flex-1"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const { path: next } = await rename.mutateAsync({ path, title: renaming });
                setRenaming(null);
                openNote(next);
              } catch {
                // erro exibido abaixo
              }
            }}
          >
            <input
              autoFocus
              value={renaming}
              onChange={(e) => setRenaming(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
              aria-label="Novo nome da nota"
              className="w-full rounded-md border border-border bg-bg px-2 py-0.5 text-xs outline-none focus:border-accent"
            />
          </form>
        ) : (
          <button
            type="button"
            title={`${path} · clique para renomear`}
            onClick={() => setRenaming(name)}
            className="min-w-0 flex-1 truncate text-left text-xs font-medium"
          >
            {name}
          </button>
        )}
        <span className="shrink-0 text-[11px] text-muted" data-testid="note-status" aria-live="polite">
          {status === 'saved' && 'Salvo'}
          {status === 'dirty' && 'Editando…'}
          {status === 'saving' && 'Salvando…'}
          {status === 'conflict' && 'Conflito'}
          {typeof status === 'object' && <span className="text-danger">Erro</span>}
        </span>
        <IconButton
          label={mode === 'view' ? 'Editar nota' : 'Visualizar nota'}
          className="size-7"
          onClick={() => setMode((m) => (m === 'view' ? 'edit' : 'view'))}
        >
          {mode === 'view' ? <Pencil size={13} /> : <Eye size={13} />}
        </IconButton>
        <IconButton
          label="Mover nota para a lixeira"
          className="size-7"
          onClick={async () => {
            try {
              await trash.mutateAsync(path);
              pending.current = null;
              openNote(null);
            } catch {
              // erro exibido abaixo
            }
          }}
        >
          <Trash2 size={13} />
        </IconButton>
      </div>

      {status === 'conflict' && (
        <div role="alert" className="border-b border-danger/40 bg-danger/10 px-3 py-2 text-xs">
          A nota foi alterada fora do editor (talvez pelo Claude) enquanto você editava.
          <div className="mt-1.5 flex gap-2">
            <Button className="px-2 py-1 text-xs" onClick={() => void reloadFromDisk()}>
              Usar a versão do disco
            </Button>
            <Button variant="danger" className="px-2 py-1 text-xs" onClick={() => void keepMine()}>
              Manter a minha
            </Button>
          </div>
        </div>
      )}
      {(typeof status === 'object' || note.isError || rename.isError || trash.isError) && (
        <p role="alert" className="px-3 py-1 text-xs text-danger">
          {typeof status === 'object' ? status.error : (note.error ?? rename.error ?? trash.error)?.message}
        </p>
      )}

      {mode === 'edit' && content !== null && <NoteToolbar view={editorView} />}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {content === null ? (
          <p className="p-4 text-xs text-muted">Carregando…</p>
        ) : mode === 'edit' ? (
          <CodeEditor
            rich
            value={content}
            onChange={onChange}
            onSave={() => void save()}
            onView={setEditorView}
            label="Conteúdo da nota"
          />
        ) : (
          <div className="px-4 py-3" data-testid="note-preview" onDoubleClick={() => setMode('edit')}>
            {content.trim() ? (
              <Markdown onNoteLink={(t) => void followLink(t)}>{content}</Markdown>
            ) : (
              <p className="text-xs text-muted italic">Nota vazia. Clique duas vezes para editar.</p>
            )}
          </div>
        )}
      </div>

      {links.data && links.data.backlinks.length > 0 && (
        <div className="border-t border-border px-3 py-2" data-testid="note-backlinks">
          <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted">
            <Link2 size={12} /> Mencionada em
          </p>
          <ul className="space-y-0.5">
            {links.data.backlinks.map((b) => (
              <li key={b.path}>
                <button
                  type="button"
                  onClick={() => openNote(b.path)}
                  className={cn('truncate text-xs text-accent hover:underline')}
                  title={b.path}
                >
                  {b.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
