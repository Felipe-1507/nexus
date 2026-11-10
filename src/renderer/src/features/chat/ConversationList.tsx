import { Archive, MessageSquarePlus, Pencil } from 'lucide-react';
import { useState } from 'react';
import { IconButton } from '@renderer/components/ui/IconButton';
import { useLayout } from '@renderer/app/shell/layout-store';
import { cn } from '@renderer/lib/cn';
import { useActiveWorkspace } from '@renderer/features/workspaces/queries';
import { useChat } from './chat-store';
import { useArchiveConversation, useConversations, useRenameConversation } from './queries';

/** Conversas do Workspace ativo, na barra lateral. */
export function ConversationList() {
  const workspace = useActiveWorkspace();
  const scope = useChat((s) => (workspace ? (s.scope[workspace.id] ?? null) : null));
  const conversations = useConversations(workspace?.id, scope);
  const selected = useChat((s) => (workspace ? s.selected[workspace.id] : undefined));
  const live = useChat((s) => s.live);
  const pending = useChat((s) => s.pending);
  const unread = useChat((s) => s.unread);
  const select = useChat((s) => s.select);
  const setView = useLayout((s) => s.setView);
  const archive = useArchiveConversation();
  const rename = useRenameConversation();
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);

  if (!workspace) return null;

  function open(conversationId: string | null) {
    select(workspace!.id, conversationId);
    setView('chat');
  }

  function commitRename(c: { id: string; title: string }) {
    const next = editing?.title.trim() ?? '';
    setEditing(null);
    if (!next || next === c.title) return;
    setRenameError(null);
    rename.mutate({ conversationId: c.id, title: next }, { onError: (err) => setRenameError(err.message) });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-border">
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <h2 className="px-2 text-[11px] font-semibold tracking-wider text-muted uppercase">Conversas</h2>
        <IconButton label="Nova conversa" onClick={() => open(null)} className="size-6">
          <MessageSquarePlus size={14} />
        </IconButton>
      </div>
      {conversations.data?.length === 0 && (
        <p className="px-5 py-2 text-xs text-muted">
          Nenhuma conversa ainda {scope ? 'neste projeto' : 'neste Workspace'}.
        </p>
      )}
      {renameError && (
        <p role="alert" className="px-5 py-1 text-xs text-danger">
          {renameError}
        </p>
      )}
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pb-2" aria-label="Lista de conversas">
        {conversations.data?.map((c) => {
          const active = selected === c.id;
          const running = Boolean(live[c.id]) || c.running;
          return (
            <li key={c.id} className="group relative">
              {editing?.id === c.id ? (
                <input
                  autoFocus
                  aria-label={`Novo nome da conversa: ${c.title}`}
                  value={editing.title}
                  maxLength={200}
                  onChange={(e) => setEditing({ id: c.id, title: e.target.value })}
                  onFocus={(e) => e.target.select()}
                  onBlur={() => commitRename(c)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(c);
                    else if (e.key === 'Escape') setEditing(null);
                  }}
                  className="w-full rounded-lg border border-accent bg-surface-2 px-2.5 py-1.5 text-[13px] text-text outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => open(c.id)}
                  onDoubleClick={() => setEditing({ id: c.id, title: c.title })}
                  onKeyDown={(e) => {
                    if (e.key === 'F2') {
                      e.preventDefault();
                      setEditing({ id: c.id, title: c.title });
                    }
                  }}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg py-1.5 pr-14 pl-2.5 text-left text-[13px] transition-colors',
                    'focus-visible:outline-2 focus-visible:outline-accent',
                    active ? 'bg-surface-2 text-text' : 'text-muted hover:bg-surface-2/60 hover:text-text',
                  )}
                >
                  {unread[c.id] && !active && (
                    <span
                      className="size-1.5 shrink-0 rounded-full bg-accent"
                      aria-label="Resposta nova"
                      title="Resposta nova"
                      data-testid="unread-dot"
                    />
                  )}
                  {(pending[c.id]?.length ?? 0) > 0 ? (
                    <span
                      className="size-1.5 shrink-0 animate-pulse rounded-full bg-amber-500"
                      aria-label="Aguardando sua aprovação"
                      title="Aguardando sua aprovação"
                    />
                  ) : (
                    running && (
                      <span
                        className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent"
                        aria-label="Respondendo"
                      />
                    )
                  )}
                  <span className="truncate">{c.title}</span>
                </button>
              )}
              {!running && editing?.id !== c.id && (
                <IconButton
                  label={`Renomear conversa: ${c.title}`}
                  onClick={() => setEditing({ id: c.id, title: c.title })}
                  className="absolute top-1/2 right-7 size-6 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <Pencil size={12} />
                </IconButton>
              )}
              {!running && editing?.id !== c.id && (
                <IconButton
                  label={`Arquivar conversa: ${c.title}`}
                  onClick={async () => {
                    await archive.mutateAsync(c.id).catch(() => undefined);
                    if (active) select(workspace.id, null);
                  }}
                  className="absolute top-1/2 right-1 size-6 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <Archive size={12} />
                </IconButton>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
