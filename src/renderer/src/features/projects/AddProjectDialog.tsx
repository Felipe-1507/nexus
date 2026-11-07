import { AlertTriangle, CheckCircle2, FolderOpen } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import type { FolderInspection } from '@shared/project';
import { Button } from '@renderer/components/ui/Button';
import { Dialog } from '@renderer/components/ui/Dialog';
import { useChat } from '@renderer/features/chat/chat-store';
import { cn } from '@renderer/lib/cn';
import { useCreateProject, useInspectFolder, usePickFolder } from './queries';

type Kind = 'linked' | 'managed';

const input =
  'w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60';

/** Adicionar projeto: vincular uma pasta existente (local ou de rede) ou criar uma pasta nova no Workspace. */
export function AddProjectDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const [kind, setKind] = useState<Kind>('linked');
  const [folder, setFolder] = useState('');
  const [name, setName] = useState('');
  const [inspection, setInspection] = useState<FolderInspection | null>(null);
  const [trust, setTrust] = useState(false);
  const pick = usePickFolder();
  const inspect = useInspectFolder();
  const create = useCreateProject();
  const setScope = useChat((s) => s.setScope);

  async function check(path: string) {
    setInspection(null);
    setTrust(false);
    if (path.trim().length < 3) return;
    try {
      const result = await inspect.mutateAsync({ workspaceId, path });
      setInspection(result);
      if (!name.trim()) setName(result.suggestedName);
    } catch {
      // erro exibido abaixo
    }
  }

  async function choose() {
    const path = await pick.mutateAsync().catch(() => null);
    if (!path) return;
    setFolder(path);
    await check(path);
  }

  const risks = inspection?.configRisks ?? [];
  const folderOk = inspection?.status === 'ok' && inspection.isDirectory && !inspection.alreadyLinked;
  // Sem confiança o projeto entra do mesmo jeito; só as configurações próprias dele ficam de fora.
  const canCreate = name.trim().length > 0 && (kind === 'managed' || folderOk) && !create.isPending;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canCreate) return;
    try {
      const project = await create.mutateAsync(
        kind === 'managed'
          ? { kind, workspaceId, name }
          : { kind, workspaceId, name, path: inspection!.path, trustConfig: risks.length > 0 && trust },
      );
      setScope(workspaceId, project.id);
      onClose();
    } catch {
      // erro exibido abaixo
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Adicionar projeto"
      description="Cada projeto tem as próprias conversas e instruções."
    >
      <form onSubmit={submit} className="space-y-4">
        <div role="radiogroup" aria-label="Tipo de projeto" className="grid grid-cols-2 gap-2">
          {(
            [
              ['linked', 'Pasta existente', 'Um repositório ou pasta, local ou na rede'],
              ['managed', 'Pasta nova', 'Criada dentro do Workspace'],
            ] as const
          ).map(([id, label, description]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={kind === id}
              onClick={() => setKind(id)}
              className={cn(
                'rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-accent',
                kind === id ? 'border-accent bg-accent-soft' : 'border-border hover:bg-surface-2',
              )}
            >
              <span className="block text-sm font-medium">{label}</span>
              <span className="mt-0.5 block text-[11px] text-muted">{description}</span>
            </button>
          ))}
        </div>

        {kind === 'linked' && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                value={folder}
                onChange={(e) => {
                  setFolder(e.target.value);
                  setInspection(null);
                }}
                onBlur={() => void check(folder)}
                placeholder="C:\dev\projeto ou \\servidor\pasta"
                aria-label="Caminho da pasta"
                className={cn(input, 'font-mono text-xs')}
              />
              <Button onClick={() => void choose()} disabled={pick.isPending} className="shrink-0">
                <FolderOpen size={14} /> Escolher…
              </Button>
            </div>
            {inspect.isPending && <p className="text-xs text-muted">Verificando a pasta…</p>}
            {inspect.isError && (
              <p role="alert" className="text-xs text-danger">
                {inspect.error.message}
              </p>
            )}
            {inspection && <InspectionResult inspection={inspection} trust={trust} onTrust={setTrust} />}
          </div>
        )}

        <label className="block">
          <span className="mb-1 block text-xs text-muted">Nome do projeto</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            aria-label="Nome do projeto"
            className={input}
          />
        </label>

        {create.isError && (
          <p role="alert" className="text-sm text-danger">
            {create.error.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" disabled={!canCreate}>
            Adicionar projeto
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function InspectionResult({
  inspection,
  trust,
  onTrust,
}: {
  inspection: FolderInspection;
  trust: boolean;
  onTrust: (v: boolean) => void;
}) {
  if (inspection.status === 'missing' || !inspection.isDirectory) {
    return <Notice tone="error">Pasta não encontrada.</Notice>;
  }
  if (inspection.status === 'unavailable') {
    return <Notice tone="error">A pasta não respondeu. Verifique se o servidor está acessível.</Notice>;
  }
  if (inspection.alreadyLinked) return <Notice tone="error">Esta pasta já está vinculada a este Workspace.</Notice>;
  if (inspection.configRisks.length === 0) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-ok">
        <CheckCircle2 size={13} /> Pasta encontrada
      </p>
    );
  }
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs" data-testid="trust-warning">
      <p className="flex items-center gap-1.5 font-medium">
        <AlertTriangle size={14} className="text-amber-500" /> Este projeto tem configurações próprias do Claude Code
      </p>
      <ul className="mt-2 list-disc space-y-0.5 pl-5">
        {inspection.configRisks.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <label className="mt-2 flex items-start gap-2">
        <input type="checkbox" checked={trust} onChange={(e) => onTrust(e.target.checked)} className="mt-0.5" />
        <span>
          Confio nestas configurações. Sem marcar, o projeto é adicionado mesmo assim, mas o Claude roda sem elas
          (inclusive sem o CLAUDE.md da pasta).
        </span>
      </label>
    </div>
  );
}

function Notice({ tone, children }: { tone: 'error'; children: ReactNode }) {
  return (
    <p role="alert" className={cn('text-xs', tone === 'error' && 'text-danger')}>
      {children}
    </p>
  );
}
