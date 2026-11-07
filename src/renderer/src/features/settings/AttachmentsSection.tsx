import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@renderer/components/ui/Button';
import { invoke } from '@renderer/lib/ipc';

const OLDER_THAN_DAYS = 90;
const usageKey = ['attachments', 'usage'] as const;

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(bytes > 0 ? 1 : 0, Math.round(bytes / 1024))} KB`;
}

/** Quanto espaço os anexos do chat ocupam e a limpeza dos antigos. */
export function AttachmentsSection() {
  const queryClient = useQueryClient();
  const usage = useQuery({ queryKey: usageKey, queryFn: () => invoke('attachments:usage') });
  const cleanup = useMutation({
    mutationFn: () => invoke('attachments:cleanup', { olderThanDays: OLDER_THAN_DAYS }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: usageKey }),
  });

  return (
    <section className="rounded-2xl border border-border bg-surface p-5" data-testid="attachments-section">
      <h2 className="text-sm font-semibold">Anexos do chat</h2>
      <p className="mt-1 text-xs text-muted">
        Imagens e PDFs colados no chat ficam guardados no Workspace. O que nunca foi enviado é apagado sozinho depois de
        3 dias.
      </p>
      <div className="mt-4 flex items-center justify-between gap-4">
        <p className="text-sm" data-testid="attachments-usage">
          {usage.data
            ? usage.data.count === 0
              ? 'Nenhum anexo guardado.'
              : `${usage.data.count} ${usage.data.count === 1 ? 'arquivo' : 'arquivos'} · ${formatBytes(usage.data.bytes)}`
            : '…'}
        </p>
        <Button
          disabled={cleanup.isPending || !usage.data || usage.data.count === 0}
          onClick={() => cleanup.mutate()}
          className="shrink-0 whitespace-nowrap"
        >
          Apagar anexos com mais de {OLDER_THAN_DAYS} dias
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-muted">
        As mensagens continuam na conversa, só que sem a miniatura do anexo apagado.
      </p>
      {cleanup.isSuccess && (
        <p role="status" className="mt-2 text-xs text-ok">
          {cleanup.data.removed === 0
            ? `Nenhum anexo com mais de ${OLDER_THAN_DAYS} dias.`
            : `${cleanup.data.removed} ${cleanup.data.removed === 1 ? 'arquivo apagado' : 'arquivos apagados'} · ${formatBytes(cleanup.data.freedBytes)} liberados.`}
        </p>
      )}
      {cleanup.isError && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {cleanup.error.message}
        </p>
      )}
    </section>
  );
}
