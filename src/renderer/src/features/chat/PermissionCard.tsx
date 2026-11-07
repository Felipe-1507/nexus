import { ShieldQuestion } from 'lucide-react';
import type { PermissionDecision, PermissionRequest } from '@shared/permissions';
import { Button } from '@renderer/components/ui/Button';
import { useRespondPermission } from './queries';

/**
 * Pedido de aprovação: a única interrupção visível durante uma resposta (chat minimalista).
 * Curto de propósito; o comando ou caminho completo aparece logo abaixo do título.
 */
export function PermissionCard({ request, queued }: { request: PermissionRequest; queued: number }) {
  const respond = useRespondPermission();
  const answer = (decision: PermissionDecision) => respond.mutate({ requestId: request.id, decision });

  return (
    <div
      role="alertdialog"
      aria-label="Pedido de permissão"
      data-testid="permission-card"
      className="mb-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3"
    >
      <div className="flex items-start gap-2.5">
        <ShieldQuestion size={18} className="mt-0.5 shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            O Claude quer <strong className="font-semibold">{request.title.toLowerCase()}</strong>
            {queued > 0 && <span className="text-muted"> (+{queued} na fila)</span>}
          </p>
          {request.detail && (
            <pre className="mt-1.5 max-h-24 overflow-auto rounded-lg bg-surface px-2.5 py-1.5 font-mono text-xs whitespace-pre-wrap">
              {request.detail}
            </pre>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {request.alwaysLabel && (
          <Button variant="ghost" className="px-2.5 py-1.5 text-xs" onClick={() => answer('allow_always')}>
            {request.alwaysLabel}
          </Button>
        )}
        <Button className="px-3 py-1.5 text-xs" onClick={() => answer('deny')} disabled={respond.isPending}>
          Negar
        </Button>
        <Button
          variant="primary"
          className="px-3 py-1.5 text-xs"
          onClick={() => answer('allow_once')}
          disabled={respond.isPending}
        >
          Permitir
        </Button>
      </div>
      {respond.isError && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {respond.error.message}
        </p>
      )}
    </div>
  );
}
