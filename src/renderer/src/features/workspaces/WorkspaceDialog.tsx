import { useState, type FormEvent } from 'react';
import {
  WORKSPACE_COLORS,
  WORKSPACE_ICONS,
  WORKSPACE_NAME_MAX,
  type Workspace,
  type WorkspaceColor,
  type WorkspaceIcon,
} from '@shared/workspace';
import { Button } from '@renderer/components/ui/Button';
import { Dialog } from '@renderer/components/ui/Dialog';
import { useLayout } from '@renderer/app/shell/layout-store';
import { cn } from '@renderer/lib/cn';
import { WorkspaceAvatar, workspaceColors, workspaceIcons } from './appearance';
import { useCreateWorkspace, useUpdateWorkspace, useWorkspaces } from './queries';

/** Monta o diálogo de criar/editar conforme o estado global. Fica uma única vez no Shell. */
export function WorkspaceDialogHost() {
  const target = useLayout((s) => s.workspaceDialog);
  const close = useLayout((s) => s.closeWorkspaceDialog);
  const { data } = useWorkspaces();
  const editing = target?.mode === 'edit' ? data?.workspaces.find((w) => w.id === target.id) : undefined;

  return (
    <Dialog
      open={target !== null}
      onClose={close}
      title={editing ? 'Editar Workspace' : 'Novo Workspace'}
      description={
        editing
          ? 'A pasta no disco continua a mesma; só o nome e a aparência mudam.'
          : 'Um ambiente com instruções, projetos, conversas e notas próprios.'
      }
    >
      {/* key: reinicia o formulário a cada abertura */}
      {target && (
        <WorkspaceForm
          key={editing?.id ?? 'novo'}
          editing={editing}
          defaultColor={WORKSPACE_COLORS[(data?.workspaces.length ?? 0) % WORKSPACE_COLORS.length]!}
          onDone={close}
        />
      )}
    </Dialog>
  );
}

function WorkspaceForm({
  editing,
  defaultColor,
  onDone,
}: {
  editing?: Workspace;
  defaultColor: WorkspaceColor;
  onDone: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? '');
  const [color, setColor] = useState<WorkspaceColor>(editing?.color ?? defaultColor);
  const [icon, setIcon] = useState<WorkspaceIcon>(editing?.icon ?? 'layers');
  const setView = useLayout((s) => s.setView);
  const create = useCreateWorkspace();
  const update = useUpdateWorkspace();
  const mutation = editing ? update : create;

  // mutateAsync: a navegação acontece mesmo se a lista recarregada remontar este formulário.
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, name, color, icon });
      } else {
        await create.mutateAsync({ name, color, icon });
        setView('chat');
      }
      onDone();
    } catch {
      // o erro aparece no formulário via mutation.error
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="flex items-center gap-3">
        <WorkspaceAvatar color={color} icon={icon} size="lg" />
        <label className="flex-1">
          <span className="sr-only">Nome</span>
          <input
            autoFocus
            value={name}
            maxLength={WORKSPACE_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome do Workspace"
            aria-label="Nome do Workspace"
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </label>
      </div>

      <fieldset>
        <legend className="mb-2 text-xs font-medium text-muted">Cor</legend>
        <div role="radiogroup" aria-label="Cor" className="flex flex-wrap gap-2">
          {WORKSPACE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={workspaceColors[c].label}
              title={workspaceColors[c].label}
              onClick={() => setColor(c)}
              className={cn(
                'size-7 rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                color === c ? 'ring-2 ring-text ring-offset-2 ring-offset-surface' : 'hover:scale-110',
              )}
              style={{ backgroundColor: workspaceColors[c].hex }}
            />
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-xs font-medium text-muted">Ícone</legend>
        <div role="radiogroup" aria-label="Ícone" className="grid grid-cols-5 gap-2">
          {WORKSPACE_ICONS.map((i) => {
            const { Icon, label } = workspaceIcons[i];
            return (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={icon === i}
                aria-label={label}
                title={label}
                onClick={() => setIcon(i)}
                className={cn(
                  'grid h-10 place-items-center rounded-lg border transition',
                  'focus-visible:outline-2 focus-visible:outline-accent',
                  icon === i
                    ? 'border-accent bg-accent-soft text-text'
                    : 'border-border text-muted hover:bg-surface-2 hover:text-text',
                )}
              >
                <Icon size={17} />
              </button>
            );
          })}
        </div>
      </fieldset>

      {mutation.isError && (
        <p role="alert" className="text-sm text-danger">
          {mutation.error.message}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button variant="primary" type="submit" disabled={mutation.isPending}>
          {editing ? 'Salvar' : 'Criar Workspace'}
        </Button>
      </div>
    </form>
  );
}
