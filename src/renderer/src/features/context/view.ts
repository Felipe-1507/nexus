import {
  cacheStatus,
  CONTEXT_LEVEL_LABELS,
  contextLevel,
  contextPercent,
  formatIdle,
  formatTokens,
  shouldWarnCache,
  type CacheStatus,
  type ContextLevel,
  type ContextSnapshot,
  type ContextThresholds,
} from '@shared/context';

export interface ContextView {
  percent: number | null;
  level: ContextLevel | null;
  cache: CacheStatus;
  warnCache: boolean;
}

export function describeContext(
  snapshot: ContextSnapshot | null,
  thresholds: ContextThresholds,
  now: number,
): ContextView {
  const percent = snapshot ? contextPercent(snapshot) : null;
  return {
    percent,
    level: contextLevel(percent, thresholds),
    cache: cacheStatus(snapshot, now),
    warnCache: shouldWarnCache(snapshot, now),
  };
}

/** Texto curto do indicador: "448 mil · 45%". Sem o tamanho, "contexto indisponível"; sem a janela, só os tokens. */
export function pillText(snapshot: ContextSnapshot | null, percent: number | null): string {
  if (!snapshot || snapshot.contextTokens === null) return 'Contexto indisponível';
  const tokens = formatTokens(snapshot.contextTokens);
  return percent === null ? `${tokens} tokens` : `${tokens} · ${Math.round(percent)}%`;
}

/** Classes de cor de cada faixa (as mesmas cores de aviso do medidor do plano). */
export const LEVEL_STYLES: Record<ContextLevel | 'unknown', { dot: string; text: string }> = {
  normal: { dot: 'bg-ok', text: 'text-muted' },
  attention: { dot: 'bg-amber-500', text: 'text-amber-500' },
  high: { dot: 'bg-amber-500', text: 'text-amber-500' },
  critical: { dot: 'bg-danger', text: 'text-danger' },
  unknown: { dot: 'bg-muted/50', text: 'text-muted' },
};

export function levelLabel(level: ContextLevel | null): string {
  return level ? CONTEXT_LEVEL_LABELS[level] : 'Sem faixa (janela do modelo desconhecida)';
}

/** Frase sobre o cache, sem afirmar o que a API não confirma. */
export function cacheSentence(cache: CacheStatus, rebuilt: boolean | null): string {
  const confirmed =
    rebuilt === true
      ? ' No último turno o cache foi regravado (confirmado pelo uso da resposta).'
      : rebuilt === false
        ? ' No último turno o cache foi aproveitado (confirmado pelo uso da resposta).'
        : '';
  if (cache.state === 'unknown') return 'Sem horário da última atividade: não dá para estimar o cache.' + confirmed;
  if (cache.state === 'maybe-expired') {
    return `Parada ${formatIdle(cache.idleMs)}. O cache de 1 h pode ter expirado; só a próxima mensagem confirma.${confirmed}`;
  }
  return `Atividade ${formatIdle(cache.idleMs)}. O cache de 1 h provavelmente ainda vale.${confirmed}`;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return 'indisponível';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'indisponível';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function formatUsd(value: number | null): string {
  if (value === null) return 'indisponível';
  return `US$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: value < 0.1 ? 4 : 2 })}`;
}
