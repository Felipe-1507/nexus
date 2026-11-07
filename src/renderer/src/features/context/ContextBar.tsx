import { ChevronDown, GitFork, TriangleAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { formatTokens, type ContextSnapshot } from '@shared/context';
import { Button } from '@renderer/components/ui/Button';
import { cn } from '@renderer/lib/cn';
import { useChat } from '@renderer/features/chat/chat-store';
import { useContextState, useNow } from './queries';
import {
  cacheSentence,
  describeContext,
  formatDateTime,
  formatUsd,
  LEVEL_STYLES,
  levelLabel,
  pillText,
  type ContextView,
} from './view';

interface ContextBarProps {
  workspaceId: string;
  conversationId: string;
  /** Conversa de origem, quando esta é uma continuação. */
  forkedFrom: string | null;
  running: boolean;
  onContinue: () => void;
  /** Ações da conversa mostradas no começo da faixa (ex.: sincronizar com o Claude Code). */
  leading?: ReactNode;
}

/**
 * Faixa discreta no topo da conversa: quanto contexto ela carrega agora, avisos quando isso pesa e, ao clicar, o
 * detalhe da medição. Tudo vem de dados que já chegaram nas respostas (nenhuma chamada extra ao Claude).
 */
export function ContextBar({ workspaceId, conversationId, forkedFrom, running, onContinue, leading }: ContextBarProps) {
  const state = useContextState(conversationId);
  const now = useNow();
  const [open, setOpen] = useState(false);
  const select = useChat((s) => s.select);

  if (!state.data) return null;
  const { snapshot, thresholds, promptChanged } = state.data;
  const view = describeContext(snapshot, thresholds, now);
  const style = LEVEL_STYLES[view.level ?? 'unknown'];

  return (
    <div className="border-b border-border" data-testid="context-bar" data-level={view.level ?? 'unknown'}>
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-1.5">
        {leading}
        {forkedFrom && (
          <button
            type="button"
            onClick={() => select(workspaceId, forkedFrom)}
            className="flex items-center gap-1.5 text-[11px] text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
            data-testid="context-open-origin"
          >
            <GitFork size={12} /> Continuação · abrir a conversa original
          </button>
        )}
        <button
          type="button"
          aria-expanded={open}
          aria-controls="context-details"
          onClick={() => setOpen((v) => !v)}
          data-testid="context-pill"
          title="Tamanho do contexto da conversa (não é o consumo da cota do plano). Clique para ver os detalhes."
          className={cn(
            'ml-auto flex items-center gap-2 rounded-lg px-2 py-1 text-[11px] transition-colors hover:bg-surface-2',
            'focus-visible:outline-2 focus-visible:outline-accent',
            style.text,
          )}
        >
          <span className={cn('size-1.5 rounded-full', style.dot)} aria-hidden />
          <span data-testid="context-pill-text">{pillText(snapshot, view.percent)}</span>
          <ChevronDown size={12} className={cn('transition-transform', open && 'rotate-180')} aria-hidden />
        </button>
      </div>

      <Warnings
        snapshot={snapshot}
        view={view}
        promptChanged={promptChanged}
        running={running}
        onContinue={onContinue}
      />

      {open && (
        <div id="context-details" className="mx-auto max-w-3xl px-6 pb-3" data-testid="context-details">
          <Details snapshot={snapshot} view={view} promptChanged={promptChanged} />
          {!running && snapshot && (
            <Button onClick={onContinue} className="mt-3" data-testid="context-continue">
              <GitFork size={14} /> Continuar em nova conversa
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function Warnings({
  snapshot,
  view,
  promptChanged,
  running,
  onContinue,
}: {
  snapshot: ContextSnapshot | null;
  view: ContextView;
  promptChanged: boolean | null;
  running: boolean;
  onContinue: () => void;
}) {
  const lines: Array<{ key: string; text: string; danger?: boolean; action?: boolean }> = [];
  if (view.level === 'critical') {
    lines.push({
      key: 'critical',
      danger: true,
      action: true,
      text: 'O contexto está quase cheio. Cada passo do Claude relê toda a conversa: recomendamos continuar numa conversa nova.',
    });
  } else if (view.level === 'high') {
    lines.push({
      key: 'high',
      action: true,
      text: 'Contexto elevado: cada passo do Claude relê toda a conversa. Considere continuar numa conversa nova.',
    });
  }
  if (view.warnCache && view.cache.state === 'maybe-expired' && snapshot?.contextTokens != null) {
    lines.push({
      key: 'cache',
      text: `Conversa parada há mais de 1 h: o cache pode ter expirado, e a próxima mensagem pode ter de regravar cerca de ${formatTokens(snapshot.contextTokens)} tokens.`,
    });
  }
  if (promptChanged) {
    lines.push({
      key: 'prompt',
      text: 'As instruções enviadas ao Claude mudaram desde a última mensagem (por exemplo, o índice de notas). Ao retomar, o cache desta conversa não será aproveitado.',
    });
  }
  if (lines.length === 0) return null;

  return (
    <div className="mx-auto max-w-3xl space-y-1 px-6 pb-2" data-testid="context-warnings">
      {lines.map((l) => (
        <p
          key={l.key}
          data-testid={`context-warning-${l.key}`}
          className={cn('flex items-start gap-2 text-[11px] leading-4', l.danger ? 'text-danger' : 'text-amber-500')}
        >
          <TriangleAlert size={12} className="mt-0.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">{l.text}</span>
          {l.action && !running && (
            <button
              type="button"
              onClick={onContinue}
              className="shrink-0 underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-accent"
            >
              Continuar
            </button>
          )}
        </p>
      ))}
    </div>
  );
}

function Details({
  snapshot,
  view,
  promptChanged,
}: {
  snapshot: ContextSnapshot | null;
  view: ContextView;
  promptChanged: boolean | null;
}) {
  if (!snapshot) {
    return (
      <p className="text-xs leading-5 text-muted" data-testid="context-empty">
        Ainda sem medição. O tamanho do contexto aparece depois da próxima resposta; em conversas antigas, quando o
        histórico do Claude Code puder ser lido. Nenhum número é estimado.
      </p>
    );
  }
  const windowNote =
    snapshot.windowTokens === null
      ? 'janela do modelo desconhecida: sem percentual'
      : `${view.percent === null ? '' : `${view.percent.toFixed(1).replace('.', ',')}% de `}${formatTokens(snapshot.windowTokens)}${
          snapshot.windowSource === 'other-conversation' ? ' (janela informada por outra conversa do mesmo modelo)' : ''
        }`;
  const rows: Array<[string, string]> = [
    [
      'Contexto',
      snapshot.contextTokens === null
        ? 'ainda não medido após a compactação'
        : `${formatTokens(snapshot.contextTokens)} tokens · ${windowNote}`,
    ],
    ['Faixa', levelLabel(view.level)],
    ['Tokens novos (sem cache)', formatTokens(snapshot.inputTokens)],
    ['Lidos do cache', formatTokens(snapshot.cacheReadTokens)],
    ['Gravados no cache', formatTokens(snapshot.cacheCreationTokens)],
    ['Modelo', snapshot.model ?? 'indisponível'],
    ['Última atividade', formatDateTime(snapshot.lastCallAt)],
    ['Cache', cacheSentence(view.cache, snapshot.cacheRebuilt)],
    [
      'Origem da medição',
      snapshot.source === 'live'
        ? 'Medida na última resposta feita no Nexus.'
        : 'Lida do histórico do Claude Code (conversa antiga ou usada fora do Nexus).',
    ],
  ];
  if (snapshot.lastCompaction) {
    const c = snapshot.lastCompaction;
    rows.push([
      'Última compactação',
      `${c.trigger === 'auto' ? 'automática' : 'manual'} · ${c.preTokens.toLocaleString('pt-BR')} → ${
        c.postTokens === null ? 'indisponível' : c.postTokens.toLocaleString('pt-BR')
      } tokens de conversa · ${formatDateTime(c.at)}`,
    ]);
  }
  rows.push([
    'Custo do último turno',
    snapshot.costUsd === null
      ? 'indisponível'
      : `${formatUsd(snapshot.costUsd)} em preço de lista (referência; não é a porcentagem da cota do plano)`,
  ]);
  if (promptChanged !== null) {
    rows.push([
      'Instruções enviadas',
      promptChanged ? 'mudaram desde a última mensagem (o cache não será aproveitado)' : 'iguais às da última mensagem',
    ]);
  }

  return (
    <dl className="grid grid-cols-[10.5rem_1fr] gap-x-4 gap-y-1.5 text-xs leading-5" data-testid="context-rows">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
