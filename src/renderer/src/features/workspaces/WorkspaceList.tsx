import { AlertTriangle, Layers, Plus, Settings2 } from 'lucide-react';
import { Button } from '@renderer/components/ui/Button';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { IconButton } from '@renderer/components/ui/IconButton';
import { useLayout } from '@renderer/app/shell/layout-store';
import { cn } from '@renderer/lib/cn';
import { WorkspaceAvatar } from './appearance';
import { useSetActiveWorkspace, useWorkspaces } from './queries';

/** Seção "Workspaces" da barra lateral. */
export function WorkspaceList() {
  const { data, isError, error } = useWorkspaces();
  const setActive = useSetActiveWorkspace();
  const view = useLayout((s) => s.view);
  const setView = useLayout((s) => s.setView);
  const openCreate = useLayout((s) => s.openCreateWorkspace);

  function select(id: string, target: 'chat' | 'workspace') {
    // Sempre confirma no main, mesmo que o cache local já diga que é o ativo (ele pode estar desatualizado).
    setActive.mutate(id);
    setView(target);
  }

  const hasWorkspaces = (data?.workspaces.length ?? 0) > 0;

  return (
    // O tamanho vem da seção da barra lateral (SidebarSections): automático até 40% ou o que o usuário arrastou.
    <div className={cn('flex min-h-0 flex-1 flex-col', hasWorkspaces && 'pb-2')}>
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <h2 className="px-2 text-[11px] font-semibold tracking-wider text-muted uppercase">Workspaces</h2>
        <IconButton label="Novo Workspace" onClick={openCreate} className="size-6">
          <Plus size={14} />
        </IconButton>
      </div>

      {isError && (
        <p role="alert" className="px-5 py-2 text-xs text-danger">
          {error.message}
        </p>
      )}

      {data && data.workspaces.length === 0 && (
        <EmptyState
          className="flex-1"
          icon={<Layers size={18} />}
          title="Nenhum Workspace ainda"
          description="Workspaces separam projetos, conversas e notas de cada área da sua vida."
        >
          <Button variant="primary" className="mt-4" onClick={openCreate}>
            <Plus size={15} /> Criar Workspace
          </Button>
        </EmptyState>
      )}

      {data && data.workspaces.length > 0 && (
        <ul className="min-h-0 space-y-0.5 overflow-y-auto px-3" aria-label="Lista de Workspaces">
          {data.workspaces.map((ws) => {
            const active = ws.id === data.activeId;
            return (
              <li key={ws.id} className="group relative">
                <button
                  type="button"
                  onClick={() => select(ws.id, 'chat')}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg py-1.5 pr-9 pl-2 text-left text-[13px] transition-colors',
                    'focus-visible:outline-2 focus-visible:outline-accent',
                    active ? 'bg-surface-2 text-text' : 'text-muted hover:bg-surface-2/60 hover:text-text',
                  )}
                >
                  <WorkspaceAvatar color={ws.color} icon={ws.icon} />
                  <span className="truncate">{ws.name}</span>
                  {ws.folderStatus === 'missing' && (
                    <AlertTriangle size={13} className="shrink-0 text-danger" aria-label="Pasta não encontrada" />
                  )}
                </button>
                <IconButton
                  label={`Abrir ${ws.name}: instruções e detalhes`}
                  onClick={() => select(ws.id, 'workspace')}
                  active={active && view === 'workspace'}
                  className={cn(
                    'absolute top-1/2 right-1 size-7 -translate-y-1/2',
                    active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                  )}
                >
                  <Settings2 size={14} />
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
