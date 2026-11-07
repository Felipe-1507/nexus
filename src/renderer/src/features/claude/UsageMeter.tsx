import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { formatResetTime, projectExhaustion, USAGE_WINDOWS, usageLevel, type UsageWindow } from '@shared/usage';
import { cn } from '@renderer/lib/cn';
import { refreshUsage, useUsage } from './usage';

/**
 * Quanto do limite do plano já foi usado (sessão de 5 horas e semana), com a hora em que reinicia e, se o ritmo
 * mantiver, quando o limite acaba. Só aparece com assinatura do claude.ai; com chave de API não há limite de plano.
 */
export function UsageMeter() {
  const { data } = useUsage();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  if (!data?.available) return null;
  const now = Date.now();

  return (
    <button
      type="button"
      data-testid="usage-meter"
      disabled={refreshing}
      title="Uso do plano do Claude. Clique para atualizar."
      onClick={async () => {
        setRefreshing(true);
        await refreshUsage(queryClient);
        setRefreshing(false);
      }}
      className={cn(
        'mb-1 w-full space-y-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-2',
        'focus-visible:outline-2 focus-visible:outline-accent',
        refreshing && 'opacity-60',
      )}
    >
      {data.windows.map((w) => (
        <Row key={w.id} window={w} now={now} />
      ))}
    </button>
  );
}

function Row({ window: w, now }: { window: UsageWindow; now: number }) {
  const meta = USAGE_WINDOWS[w.id];
  const level = usageLevel(w.percent);
  const projection = projectExhaustion(w.percent, w.resetsAt, meta.ms, now);
  const percent = Math.round(w.percent);
  return (
    <div data-testid={`usage-${w.id}`} data-level={level}>
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="text-muted">{meta.label}</span>
        <span className={cn('font-medium', level === 'danger' && 'text-danger', level === 'warn' && 'text-amber-500')}>
          {percent}%
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={`${meta.label}: ${percent}% usado`}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2"
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width]',
            level === 'ok' && 'bg-accent',
            level === 'warn' && 'bg-amber-500',
            level === 'danger' && 'bg-danger',
          )}
          style={{ width: `${Math.max(2, percent)}%` }}
        />
      </div>
      <p className="mt-0.5 text-[10px] leading-4 text-muted">
        {w.resetsAt ? `reinicia ${formatResetTime(w.resetsAt, now)}` : 'sem hora de reinício'}
        {projection && (
          <span className={level === 'ok' ? undefined : 'text-amber-500'}>
            {' '}
            · no ritmo atual, acaba {formatResetTime(new Date(projection.at).toISOString(), now)}
          </span>
        )}
      </p>
    </div>
  );
}
