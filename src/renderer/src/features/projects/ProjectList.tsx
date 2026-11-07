import { AlertTriangle, Folder, FolderPlus, Layers, Network, Settings2 } from 'lucide-react';
import { useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { Project } from '@shared/project';
import { IconButton } from '@renderer/components/ui/IconButton';
import { useLayout } from '@renderer/app/shell/layout-store';
import { useChat } from '@renderer/features/chat/chat-store';
import { useOpenScope } from '@renderer/features/chat/queries';
import { useActiveWorkspace } from '@renderer/features/workspaces/queries';
import { cn } from '@renderer/lib/cn';
import { AddProjectDialog } from './AddProjectDialog';
import { moveBefore, moveBy } from './order';
import { useProjects, useReorderProjects } from './queries';

/** Caminho de rede (\\servidor\...). */
export function isNetworkPath(p: string): boolean {
  return p.startsWith('\\\\');
}

/** Problema do projeto para o ícone de alerta (ou null). */
export function projectIssue(p: Project): string | null {
  if (p.status === 'missing') return 'Pasta não encontrada';
  if (p.status === 'unavailable') return 'Pasta não respondeu (rede?)';
  if (p.configTrust === 'changed') return 'Configurações do projeto mudaram: revise';
  return null;
}

/** "Geral" + projetos do Workspace ativo. Escolher um define em qual escopo as conversas acontecem. */
export function ProjectList() {
  const workspace = useActiveWorkspace();
  const projects = useProjects(workspace?.id);
  const scope = useChat((s) => (workspace ? (s.scope[workspace.id] ?? null) : null));
  const openScope = useOpenScope();
  const view = useLayout((s) => s.view);
  const setView = useLayout((s) => s.setView);
  const [adding, setAdding] = useState(false);
  const reorder = useReorderProjects(workspace?.id ?? '');
  // Arrastar: `dropBefore` é o projeto antes do qual o arrastado cairia (null = no fim, undefined = em lugar nenhum).
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropBefore, setDropBefore] = useState<string | null | undefined>(undefined);

  if (!workspace) return null;

  const ids = projects.data?.map((p) => p.id) ?? [];
  const save = (next: string[]) => next !== ids && reorder.mutate(next);
  const endDrag = () => {
    setDragId(null);
    setDropBefore(undefined);
  };

  function onDragOver(e: DragEvent<HTMLLIElement>, id: string) {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const box = e.currentTarget.getBoundingClientRect();
    const upper = e.clientY < box.top + box.height / 2;
    setDropBefore(upper ? id : (ids[ids.indexOf(id) + 1] ?? null));
  }

  function onDrop(e: DragEvent<HTMLLIElement>) {
    e.preventDefault();
    if (dragId && dropBefore !== undefined) save(moveBefore(ids, dragId, dropBefore));
    endDrag();
  }

  // Alt + seta move o projeto sem mouse.
  function onKeyDown(e: KeyboardEvent, id: string) {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    save(moveBy(ids, id, e.key === 'ArrowUp' ? -1 : 1));
  }

  function open(projectId: string | null, target: 'chat' | 'project') {
    void openScope(workspace!.id, projectId);
    setView(target);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-border pb-2">
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <h2
          className="px-2 text-[11px] font-semibold tracking-wider text-muted uppercase"
          title="Arraste os projetos para mudar a ordem (ou use Alt + seta para cima/baixo)"
        >
          Projetos
        </h2>
        <IconButton label="Adicionar projeto" onClick={() => setAdding(true)} className="size-6">
          <FolderPlus size={14} />
        </IconButton>
      </div>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3" aria-label="Lista de projetos">
        <li>
          <Item
            icon={<Layers size={14} />}
            label="Geral"
            title="Conversas gerais do Workspace"
            active={scope === null}
            onClick={() => open(null, 'chat')}
          />
        </li>
        {projects.data?.map((p) => {
          const issue = projectIssue(p);
          return (
            <li
              key={p.id}
              className={cn('group relative', dragId === p.id && 'opacity-40')}
              draggable
              data-testid={`project-${p.name}`}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', p.id);
                setDragId(p.id);
              }}
              onDragOver={(e) => onDragOver(e, p.id)}
              onDrop={onDrop}
              onDragEnd={endDrag}
            >
              {dragId && dragId !== p.id && dropBefore === p.id && <DropLine className="-top-px" />}
              {dragId && dragId !== p.id && dropBefore === null && p.id === ids[ids.length - 1] && (
                <DropLine className="-bottom-px" />
              )}
              <Item
                icon={isNetworkPath(p.path) ? <Network size={14} /> : <Folder size={14} />}
                label={p.name}
                title={p.path}
                active={scope === p.id}
                onClick={() => open(p.id, 'chat')}
                issue={issue}
                onKeyDown={(e) => onKeyDown(e, p.id)}
              />
              <IconButton
                label={`Abrir projeto ${p.name}: instruções e detalhes`}
                onClick={() => open(p.id, 'project')}
                active={scope === p.id && view === 'project'}
                className={cn(
                  'absolute top-1/2 right-1 size-6 -translate-y-1/2',
                  scope === p.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                )}
              >
                <Settings2 size={12} />
              </IconButton>
            </li>
          );
        })}
      </ul>
      {projects.isError && (
        <p role="alert" className="px-5 pt-1 text-xs text-danger">
          {projects.error.message}
        </p>
      )}
      {adding && <AddProjectDialog workspaceId={workspace.id} onClose={() => setAdding(false)} />}
    </div>
  );
}

function DropLine({ className }: { className: string }) {
  return (
    <span aria-hidden className={cn('pointer-events-none absolute inset-x-1 h-0.5 rounded bg-accent', className)} />
  );
}

function Item({
  icon,
  label,
  title,
  active,
  onClick,
  issue,
  onKeyDown,
}: {
  icon: ReactNode;
  label: string;
  title: string;
  active: boolean;
  onClick: () => void;
  issue?: string | null;
  onKeyDown?: (e: KeyboardEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onKeyDown={onKeyDown}
      title={title}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg py-1.5 pr-8 pl-2.5 text-left text-[13px] transition-colors',
        'focus-visible:outline-2 focus-visible:outline-accent',
        active ? 'bg-surface-2 text-text' : 'text-muted hover:bg-surface-2/60 hover:text-text',
      )}
    >
      <span className={active ? 'text-accent' : undefined}>{icon}</span>
      <span className="truncate">{label}</span>
      {issue && <AlertTriangle size={12} className="shrink-0 text-amber-500" aria-label={issue} />}
    </button>
  );
}
