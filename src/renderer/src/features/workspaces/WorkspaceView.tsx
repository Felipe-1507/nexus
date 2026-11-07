import { AlertTriangle, ArrowLeft, Archive, FolderOpen, Pencil } from 'lucide-react';
import { useState } from 'react';
import type { Workspace } from '@shared/workspace';
import { Button } from '@renderer/components/ui/Button';
import { Dialog } from '@renderer/components/ui/Dialog';
import { IconButton } from '@renderer/components/ui/IconButton';
import { useLayout } from '@renderer/app/shell/layout-store';
import { WorkspaceAvatar } from './appearance';
import { InstructionsEditor } from './InstructionsEditor';
import { ModelDefaultSection } from './ModelDefaultSection';
import { PermissionsSection } from './PermissionsSection';
import { useActiveWorkspace, useArchiveWorkspace, useInstructions, useOpenWorkspaceFolder } from './queries';

/** Página do Workspace ativo: instruções para o Claude, permissões, pasta no disco e arquivamento. */
export function WorkspaceView() {
  const ws = useActiveWorkspace();
  const setView = useLayout((s) => s.setView);

  if (!ws) {
    return (
      <div className="grid h-full place-items-center text-sm text-muted">
        <Button onClick={() => setView('chat')}>Voltar</Button>
      </div>
    );
  }
  return <WorkspaceDetails key={ws.id} ws={ws} />;
}

function WorkspaceDetails({ ws }: { ws: Workspace }) {
  const setView = useLayout((s) => s.setView);
  const openEdit = useLayout((s) => s.openEditWorkspace);
  const openFolder = useOpenWorkspaceFolder();
  const instructions = useInstructions(ws.id);

  return (
    <div className="h-full overflow-y-auto" data-testid="workspace-view">
      <div className="mx-auto max-w-3xl px-8 py-8">
        <div className="mb-6 flex items-center gap-3">
          <IconButton label="Voltar ao chat" onClick={() => setView('chat')}>
            <ArrowLeft size={16} />
          </IconButton>
          <WorkspaceAvatar color={ws.color} icon={ws.icon} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold tracking-tight">{ws.name}</h1>
            <p className="truncate font-mono text-xs text-muted" title={ws.rootPath}>
              {ws.rootPath}
            </p>
          </div>
          <Button onClick={() => openEdit(ws.id)}>
            <Pencil size={14} /> Editar
          </Button>
          <Button onClick={() => openFolder.mutate(ws.id)} disabled={ws.folderStatus === 'missing'}>
            <FolderOpen size={14} /> Abrir pasta
          </Button>
        </div>

        {ws.folderStatus === 'missing' && (
          <div role="alert" className="mb-6 flex gap-2 rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger" />A pasta deste Workspace não foi
            encontrada no disco. Ela pode ter sido movida ou apagada.
          </div>
        )}
        {openFolder.isError && (
          <p role="alert" className="mb-4 text-sm text-danger">
            {openFolder.error.message}
          </p>
        )}

        <section className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold">Instruções para o Claude</h2>
          <p className="mt-1 mb-4 text-xs leading-5 text-muted">
            Enviadas em todas as conversas deste Workspace. Descreva o contexto desta área, como você gosta que ele
            trabalhe e as regras que deve seguir. Ficam no arquivo <code className="font-mono">workspace.md</code>.
          </p>
          {instructions.isPending && <p className="text-sm text-muted">Carregando…</p>}
          {instructions.isError && (
            <p role="alert" className="text-sm text-danger">
              {instructions.error.message}
            </p>
          )}
          {instructions.data && <InstructionsEditor workspaceId={ws.id} initial={instructions.data} />}
        </section>

        <ModelDefaultSection ws={ws} />
        <PermissionsSection ws={ws} />
        <ArchiveSection ws={ws} />
      </div>
    </div>
  );
}

function ArchiveSection({ ws }: { ws: Workspace }) {
  const [confirming, setConfirming] = useState(false);
  const archive = useArchiveWorkspace();
  const setView = useLayout((s) => s.setView);

  return (
    <section className="mt-6 flex items-center justify-between gap-4 rounded-2xl border border-border p-5">
      <div>
        <h2 className="text-sm font-semibold">Arquivar Workspace</h2>
        <p className="mt-1 text-xs text-muted">Ele sai da lista. Nenhum arquivo é apagado.</p>
      </div>
      <Button onClick={() => setConfirming(true)}>
        <Archive size={14} /> Arquivar
      </Button>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Arquivar "${ws.name}"?`}
        description={`O Workspace sai da lista. A pasta continua em ${ws.rootPath}.`}
      >
        {archive.isError && (
          <p role="alert" className="mb-3 text-sm text-danger">
            {archive.error.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            disabled={archive.isPending}
            onClick={async () => {
              // mutateAsync em vez de callbacks do mutate: arquivar troca o Workspace ativo e esta tela é
              // remontada antes do fim, e callbacks de componentes desmontados não são chamados.
              try {
                await archive.mutateAsync(ws.id);
                setView('chat');
              } catch {
                // o erro aparece no diálogo via archive.error
              }
            }}
          >
            Arquivar
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
