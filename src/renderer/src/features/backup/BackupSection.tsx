import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '@renderer/components/ui/Button';
import { invoke } from '@renderer/lib/ipc';

function size(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1).replace('.', ',')} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2).replace('.', ',')} GB`;
}

/** Configurações → Backup: um .zip com o banco, as preferências e a pasta de conteúdo. */
export function BackupSection() {
  const preview = useQuery({ queryKey: ['backup', 'preview'], queryFn: () => invoke('backup:preview'), staleTime: 0 });
  const run = useMutation({ mutationFn: () => invoke('backup:export') });
  const done = run.data;

  return (
    <section className="rounded-2xl border border-border bg-surface p-5" data-testid="backup-section">
      <h2 className="text-sm font-semibold">Backup</h2>
      <p className="mt-1 text-xs text-muted">
        Um arquivo .zip com as conversas e Workspaces (banco), as preferências e a pasta de conteúdo
        {preview.data ? ` (${preview.data.files.toLocaleString('pt-BR')} arquivos, ${size(preview.data.bytes)})` : ''}.
        Projetos vinculados a pastas de fora não entram: já são arquivos seus em outro lugar.
      </p>
      <div className="mt-4 flex items-center gap-3">
        <Button onClick={() => run.mutate()} disabled={run.isPending} data-testid="backup-export">
          {run.isPending ? 'Criando o backup…' : 'Exportar backup…'}
        </Button>
        {run.isSuccess && done === null && <span className="text-xs text-muted">Cancelado.</span>}
      </div>
      {done && (
        <p className="mt-3 text-xs" data-testid="backup-done">
          Backup salvo ({size(done.bytes)}, {done.files.toLocaleString('pt-BR')} arquivos):{' '}
          <span className="font-mono break-all text-muted">{done.path}</span>
        </p>
      )}
      {run.isError && (
        <p role="alert" className="mt-3 text-xs text-danger">
          {run.error.message}
        </p>
      )}
    </section>
  );
}
