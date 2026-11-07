import { FolderOpen, SquareArrowOutUpRight } from 'lucide-react';
import type { CodeScope } from '@shared/code';
import { IconButton } from '@renderer/components/ui/IconButton';
import { useChat } from '@renderer/features/chat/chat-store';
import { FileTree } from '@renderer/features/code/FileTree';
import { useOpenInVsCode } from '@renderer/features/code/queries';
import { useActiveWorkspace } from '@renderer/features/workspaces/queries';
import { useProjects } from './queries';

/** Pastas e arquivos do projeto escolhido (ou do Workspace, em "Geral"), logo abaixo das conversas. */
export function FolderSection() {
  const workspace = useActiveWorkspace();
  const projectId = useChat((s) => (workspace ? (s.scope[workspace.id] ?? null) : null));
  const project = useProjects(workspace?.id).data?.find((p) => p.id === projectId);
  const vscode = useOpenInVsCode();

  if (!workspace) return null;
  const scope: CodeScope = { workspaceId: workspace.id, projectId };
  const rootName = project?.name ?? workspace.name;

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-border" data-testid="folder-section">
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <h2
          className="flex min-w-0 items-center gap-1.5 px-2 text-[11px] font-semibold tracking-wider text-muted uppercase"
          title={rootName}
        >
          <FolderOpen size={12} className="shrink-0 text-accent" />
          <span className="truncate">Pastas · {rootName}</span>
        </h2>
        <IconButton
          label="Abrir pasta no VS Code"
          className="size-6"
          onClick={() => vscode.mutate({ ...scope, path: '' })}
        >
          <SquareArrowOutUpRight size={13} />
        </IconButton>
      </div>
      {vscode.isError && (
        <p role="alert" className="px-5 py-1 text-xs text-danger">
          {vscode.error.message}
        </p>
      )}
      {/* A árvore é recriada ao trocar de projeto: nada de pasta aberta que não existe no outro. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" key={projectId ?? 'ws'}>
        <FileTree scope={scope} />
      </div>
    </div>
  );
}
