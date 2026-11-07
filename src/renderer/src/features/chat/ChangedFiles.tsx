import { FileText, RotateCcw, Undo2 } from 'lucide-react';
import { useState } from 'react';
import type { ChatMessage } from '@shared/chat';
import { Button } from '@renderer/components/ui/Button';
import { Dialog } from '@renderer/components/ui/Dialog';
import { useLayout } from '@renderer/app/shell/layout-store';
import { useWorkspaces } from '@renderer/features/workspaces/queries';
import { useUndo } from './queries';

/** Nome do arquivo a partir de um caminho do Windows ou POSIX (a tela não tem acesso ao módulo path). */
function baseName(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

/** Caminho da nota dentro do vault (com `/`), se o arquivo for uma nota `.md` do Workspace; senão null. */
export function notePathIn(knowledgeDir: string, file: string): string | null {
  const norm = (s: string) => s.replace(/[\\/]+/g, '/').replace(/\/$/, '');
  const dir = norm(knowledgeDir);
  const target = norm(file);
  if (!target.toLowerCase().startsWith(`${dir.toLowerCase()}/`) || !target.toLowerCase().endsWith('.md')) return null;
  return target.slice(dir.length + 1);
}

/**
 * Arquivos que a resposta criou ou editou, como cartões. Na última resposta, oferece "Desfazer", que volta os
 * arquivos ao estado de antes da mensagem (checkpoint do Claude Code).
 */
export function ChangedFiles({
  message,
  workspaceId,
  canUndo,
}: {
  message: ChatMessage;
  workspaceId: string;
  canUndo: boolean;
}) {
  const files = [...new Set(message.activities.flatMap((a) => (a.changedFile ? [a.changedFile] : [])))];
  const undo = useUndo();
  const openNote = useLayout((s) => s.openNote);
  const openDiff = useLayout((s) => s.openDiff);
  const knowledgeDir = useWorkspaces().data?.workspaces.find((w) => w.id === workspaceId)?.knowledgeDir;
  const [confirm, setConfirm] = useState<string[] | null>(null);
  if (files.length === 0) return null;

  const ids = { conversationId: message.conversationId, messageId: message.id };

  async function askUndo() {
    try {
      const preview = await undo.mutateAsync({ ...ids, dryRun: true });
      setConfirm(preview.files.length > 0 ? preview.files : files);
    } catch {
      // erro exibido abaixo
    }
  }

  async function doUndo() {
    try {
      await undo.mutateAsync({ ...ids, dryRun: false });
      setConfirm(null);
    } catch {
      // erro exibido no diálogo
    }
  }

  return (
    <div className="mt-3" data-testid="changed-files">
      <div className="flex flex-wrap items-center gap-2">
        {files.map((f) => {
          // Notas do segundo cérebro abrem ao lado da conversa; os demais arquivos abrem o diff desta resposta.
          const note = knowledgeDir ? notePathIn(knowledgeDir, f) : null;
          return (
            <button
              key={f}
              type="button"
              title={note ? `Abrir nota: ${note}` : `Ver alterações: ${f}`}
              onClick={() =>
                note ? openNote(workspaceId, note) : openDiff({ workspaceId, messageId: message.id, path: f })
              }
              className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
            >
              <FileText size={13} className="text-accent" />
              {baseName(f)}
            </button>
          );
        })}
        {message.undoneAt ? (
          <span className="flex items-center gap-1 text-xs text-muted">
            <RotateCcw size={12} /> Alterações desfeitas
          </span>
        ) : (
          canUndo && (
            <Button
              variant="ghost"
              className="px-2 py-1 text-xs"
              onClick={() => void askUndo()}
              disabled={undo.isPending}
            >
              <Undo2 size={13} /> Desfazer
            </Button>
          )
        )}
      </div>
      {undo.isError && !confirm && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {undo.error.message}
        </p>
      )}
      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title="Desfazer as alterações?"
        description="Os arquivos voltam ao estado de antes desta mensagem. Comandos executados não são desfeitos."
      >
        <ul className="mb-4 max-h-40 space-y-1 overflow-y-auto">
          {confirm?.map((f) => (
            <li key={f} className="truncate font-mono text-xs" title={f}>
              {f}
            </li>
          ))}
        </ul>
        {undo.isError && (
          <p role="alert" className="mb-3 text-sm text-danger">
            {undo.error.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(null)}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={() => void doUndo()} disabled={undo.isPending}>
            Desfazer
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
