import { Eye, Hand, Sparkles, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AuditEntry, PermissionMode } from '@shared/permissions';
import type { Workspace } from '@shared/workspace';
import { IconButton } from '@renderer/components/ui/IconButton';
import { cn } from '@renderer/lib/cn';
import { usePermissionAudit, usePermissionRules, useRemoveRule, useSetPermissionMode } from './permission-queries';

const modes: Array<{ id: PermissionMode; label: string; description: string; icon: ReactNode }> = [
  {
    id: 'auto',
    label: 'Auto',
    description: 'Trabalha e entrega. Só interrompe em ações arriscadas.',
    icon: <Sparkles size={16} />,
  },
  {
    id: 'ask',
    label: 'Perguntar',
    description: 'Pede sua aprovação antes de editar arquivos e executar comandos.',
    icon: <Hand size={16} />,
  },
  {
    id: 'read_only',
    label: 'Somente leitura',
    description: 'Consulta e responde, mas não altera nada.',
    icon: <Eye size={16} />,
  },
];

const decidedByLabels: Record<AuditEntry['decidedBy'], string> = {
  policy: 'regra do Nexus',
  rule: 'regra liberada',
  user: 'você',
  timeout: 'sem resposta',
  cancel: 'resposta interrompida',
};

/** Permissões do Workspace: modo, regras "sempre permitir" e histórico de decisões. */
export function PermissionsSection({ ws }: { ws: Workspace }) {
  const setMode = useSetPermissionMode();
  const rules = usePermissionRules(ws.id);
  const removeRule = useRemoveRule(ws.id);
  const audit = usePermissionAudit(ws.id);
  const current = setMode.isPending ? setMode.variables.mode : ws.permissionMode;

  return (
    <section className="mt-6 rounded-2xl border border-border bg-surface p-5" data-testid="permissions-section">
      <h2 className="text-sm font-semibold">Permissões</h2>
      <p className="mt-1 mb-4 text-xs text-muted">
        Vale para as próximas mensagens. Leitura dentro da pasta do Workspace é sempre liberada.
      </p>

      <div role="radiogroup" aria-label="Modo de permissão" className="grid gap-2 sm:grid-cols-3">
        {modes.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={current === m.id}
            onClick={() => setMode.mutate({ id: ws.id, mode: m.id })}
            className={cn(
              'rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-accent',
              current === m.id ? 'border-accent bg-accent-soft' : 'border-border hover:bg-surface-2',
            )}
          >
            <span className={cn('flex items-center gap-2 text-sm font-medium', current === m.id && 'text-accent')}>
              {m.icon}
              {m.label}
            </span>
            <span className="mt-1 block text-xs leading-5 text-muted">{m.description}</span>
          </button>
        ))}
      </div>
      {setMode.isError && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {setMode.error.message}
        </p>
      )}

      <h3 className="mt-6 text-xs font-semibold text-muted uppercase">Sempre permitido</h3>
      {rules.data?.length === 0 && (
        <p className="mt-2 text-xs text-muted">
          Nada ainda. Use &quot;Sempre permitir&quot; num pedido de aprovação para liberar um comando.
        </p>
      )}
      <ul className="mt-2 space-y-1" aria-label="Regras liberadas">
        {rules.data?.map((r) => (
          <li
            key={r.id}
            className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-1.5 text-xs"
          >
            <span className="truncate">{r.label}</span>
            <IconButton label={`Remover regra: ${r.label}`} className="size-6" onClick={() => removeRule.mutate(r.id)}>
              <X size={12} />
            </IconButton>
          </li>
        ))}
      </ul>

      <h3 className="mt-6 text-xs font-semibold text-muted uppercase">Últimas decisões</h3>
      {audit.data?.length === 0 && <p className="mt-2 text-xs text-muted">Nenhuma decisão registrada ainda.</p>}
      <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto" aria-label="Histórico de permissões">
        {audit.data?.map((a) => (
          <li key={a.id} className="flex items-start gap-2 text-xs">
            <span
              className={cn(
                'mt-0.5 shrink-0 rounded px-1.5 py-px font-medium',
                a.decision === 'allow' ? 'bg-ok/15 text-ok' : 'bg-danger/15 text-danger',
              )}
            >
              {a.decision === 'allow' ? 'Permitido' : 'Negado'}
            </span>
            <div className="min-w-0">
              <p>
                {a.summary} <span className="text-muted">· {decidedByLabels[a.decidedBy]}</span>
              </p>
              {a.detail && <p className="truncate font-mono text-[11px] text-muted">{a.detail}</p>}
            </div>
            <time className="ml-auto shrink-0 text-[11px] text-muted" dateTime={a.createdAt}>
              {new Date(a.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
            </time>
          </li>
        ))}
      </ul>
    </section>
  );
}
