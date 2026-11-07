import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { NexusError } from '@shared/ipc-result';
import { INSTRUCTIONS_MAX_BYTES, type Instructions } from '@shared/workspace';
import { Button } from '@renderer/components/ui/Button';
import { invoke } from '@renderer/lib/ipc';
import { workspaceKeys } from './queries';

type Status =
  | { kind: 'saved' }
  | { kind: 'dirty' }
  | { kind: 'saving' }
  | { kind: 'conflict' }
  | { kind: 'error'; message: string };

const AUTOSAVE_MS = 800;

/**
 * Editor do workspace.md com salvamento automático. Cada gravação envia o mtime da versão que o editor
 * conhece; se o arquivo mudou por fora, o main recusa e o usuário decide qual versão fica.
 */
export function InstructionsEditor({ workspaceId, initial }: { workspaceId: string; initial: Instructions }) {
  const queryClient = useQueryClient();
  const [content, setContent] = useState(initial.content);
  const [status, setStatus] = useState<Status>({ kind: 'saved' });
  const mtime = useRef(initial.mtimeMs);
  const pending = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const save = useCallback(async () => {
    window.clearTimeout(timer.current);
    const text = pending.current;
    if (text === null) return;
    pending.current = null;
    setStatus({ kind: 'saving' });
    try {
      const { mtimeMs } = await invoke('workspaces:saveInstructions', {
        id: workspaceId,
        content: text,
        expectedMtimeMs: mtime.current,
      });
      mtime.current = mtimeMs;
      queryClient.setQueryData(workspaceKeys.instructions(workspaceId), { content: text, mtimeMs });
      setStatus(pending.current === null ? { kind: 'saved' } : { kind: 'dirty' });
    } catch (err) {
      pending.current ??= text;
      const e = err as NexusError;
      setStatus(e.code === 'CONFLICT' ? { kind: 'conflict' } : { kind: 'error', message: e.message });
    }
  }, [queryClient, workspaceId]);

  // Ao sair da tela, grava o que ainda não foi salvo.
  useEffect(
    () => () => {
      if (pending.current !== null) void save();
    },
    [save],
  );

  function onChange(text: string) {
    setContent(text);
    pending.current = text;
    if (status.kind === 'conflict') return; // não insiste até o usuário decidir
    setStatus({ kind: 'dirty' });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), AUTOSAVE_MS);
  }

  async function takeDiskVersion() {
    const fresh = await invoke('workspaces:readInstructions', { id: workspaceId });
    pending.current = null;
    mtime.current = fresh.mtimeMs;
    setContent(fresh.content);
    setStatus({ kind: 'saved' });
  }

  async function keepMine() {
    const fresh = await invoke('workspaces:readInstructions', { id: workspaceId });
    mtime.current = fresh.mtimeMs;
    pending.current = content;
    await save();
  }

  const bytes = new TextEncoder().encode(content).length;

  return (
    <div>
      {status.kind === 'conflict' && (
        <div role="alert" className="mb-3 rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm">
          <p>O arquivo de instruções foi alterado fora do Nexus enquanto você editava.</p>
          <div className="mt-2 flex gap-2">
            <Button onClick={() => void takeDiskVersion()}>Usar a versão do disco</Button>
            <Button variant="danger" onClick={() => void keepMine()}>
              Manter a minha
            </Button>
          </div>
        </div>
      )}
      <textarea
        value={content}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.ctrlKey && e.key.toLowerCase() === 's') {
            e.preventDefault();
            void save();
          }
        }}
        spellCheck
        aria-label="Instruções do Workspace"
        placeholder="Ex.: Trabalho com planilhas e relatórios. Valores sempre em BRL. Antes de alterar planilhas, me mostre o resumo."
        className="min-h-80 w-full resize-y rounded-xl border border-border bg-bg p-4 font-mono text-[13px] leading-6 outline-none focus:border-accent"
      />
      <div className="mt-2 flex items-center justify-between text-xs text-muted">
        <span data-testid="instructions-status" aria-live="polite">
          {status.kind === 'saved' && 'Salvo'}
          {status.kind === 'dirty' && 'Alterações não salvas'}
          {status.kind === 'saving' && 'Salvando…'}
          {status.kind === 'conflict' && 'Conflito com o arquivo no disco'}
          {status.kind === 'error' && <span className="text-danger">{status.message}</span>}
        </span>
        <span className={bytes > INSTRUCTIONS_MAX_BYTES ? 'text-danger' : undefined}>
          {(bytes / 1024).toFixed(1)} / {INSTRUCTIONS_MAX_BYTES / 1024} KB
        </span>
      </div>
    </div>
  );
}
