import { AlertCircle, ChevronRight, MessageSquareText, Pencil, Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AttachmentChip } from './AttachmentChip';
import { useChat } from './chat-store';
import { CopyButton } from './CopyButton';
import type { Activity, ChatMessage } from '@shared/chat';
import { Markdown } from '@renderer/components/Markdown';
import { cn } from '@renderer/lib/cn';
import { formatFullTime, formatMessageTime } from '@renderer/lib/format-time';
import { ChangedFiles } from './ChangedFiles';

export function MessageItem({
  message,
  workspaceId,
  canUndo = false,
}: {
  message: ChatMessage;
  workspaceId: string;
  /** Só a última resposta oferece "Desfazer". */
  canUndo?: boolean;
}) {
  if (message.role === 'user') {
    return (
      <div className="group flex justify-end" data-testid="message-user">
        <div className="max-w-[85%] space-y-2">
          {message.attachments.length > 0 && (
            <div className="flex flex-wrap justify-end gap-1.5" data-testid="message-attachments">
              {message.attachments.map((a) => (
                <AttachmentChip key={a.id} workspaceId={workspaceId} attachment={a} />
              ))}
            </div>
          )}
          {message.content && (
            <div className="rounded-2xl rounded-br-md bg-accent-soft px-4 py-2.5 text-sm leading-6 whitespace-pre-wrap">
              {message.content}
            </div>
          )}
          <div className="flex items-center justify-end gap-1">
            <MessageTime iso={message.createdAt} />
            <div className={ACTIONS} data-testid="message-actions">
              {message.content && <CopyButton text={message.content} label="Copiar mensagem" />}
              <button
                type="button"
                aria-label="Editar mensagem"
                title="Põe a mensagem de volta no campo para você mudar e reenviar (a mensagem antiga continua na conversa)"
                onClick={() =>
                  useChat.getState().setPrefill(message.conversationId, {
                    text: message.content,
                    attachments: message.attachments,
                  })
                }
                className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
              >
                <Pencil size={12} /> Editar
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="group" data-testid="message-assistant" data-status={message.status}>
      {message.content && <Markdown>{message.content}</Markdown>}
      {message.content && (
        <div className="mt-1 flex items-center gap-2">
          <MessageTime iso={message.createdAt} />
          <div className={cn(ACTIONS, 'justify-start')} data-testid="message-actions">
            <CopyButton text={message.content} label="Copiar resposta" />
          </div>
        </div>
      )}
      {message.status === 'interrupted' && <p className="mt-1 text-xs text-muted italic">Resposta interrompida.</p>}
      {message.status === 'error' && (
        <p role="alert" className="mt-2 flex gap-2 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-danger" />
          {message.error}
        </p>
      )}
      <ChangedFiles message={message} workspaceId={workspaceId} canUndo={canUndo} />
      <Details activities={message.activities} usage={message.usage} model={message.model} />
    </div>
  );
}

/** Horário da mensagem: sempre visível e discreto; a dica traz a data completa. */
function MessageTime({ iso }: { iso: string }) {
  const text = formatMessageTime(iso);
  if (!text) return null;
  return (
    <time
      dateTime={iso}
      title={formatFullTime(iso)}
      data-testid="message-time"
      className="text-[11px] text-muted tabular-nums"
    >
      {text}
    </time>
  );
}

/** Botões que aparecem ao passar o mouse sobre a mensagem (ou ao navegar por teclado até eles). */
const ACTIONS =
  'flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100';

/** "Ver detalhes": o que o Claude fez e quanto contexto usou. Recolhido por padrão (chat minimalista). */
export function Details({
  activities,
  usage,
  model,
  live,
}: {
  activities: Activity[];
  usage?: ChatMessage['usage'];
  model?: string | null;
  /** Resposta em andamento: o botão aparece mesmo sem passos e mostra há quanto tempo o Claude trabalha. */
  live?: { startedAt: number; lastEventAt: number };
}) {
  const [open, setOpen] = useState(false);
  const now = useNow(Boolean(live));
  if (!live && activities.length === 0 && !usage && !model) return null;
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1 rounded text-xs text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
      >
        <ChevronRight size={13} className={cn('transition-transform', open && 'rotate-90')} />
        Ver detalhes
        {activities.length > 0 && (
          <span>
            · {activities.length} {activities.length === 1 ? 'passo' : 'passos'}
          </span>
        )}
      </button>
      {live && <LiveStatus live={live} now={now} />}
      {open && (
        <div className="mt-2 space-y-1.5 border-l border-border pl-3" data-testid="message-details">
          {live && activities.length === 0 && <p className="text-xs text-muted">Ainda sem passos registrados.</p>}
          {activities.map((a, i) => (
            <div key={i} className="flex gap-2 text-xs">
              {a.kind === 'tool' ? (
                <Wrench size={12} className={cn('mt-0.5 shrink-0', a.error ? 'text-danger' : 'text-muted')} />
              ) : (
                <MessageSquareText size={12} className="mt-0.5 shrink-0 text-muted" />
              )}
              <div className="min-w-0">
                <p className={a.kind === 'intermediate' ? 'text-muted italic' : undefined}>
                  {a.label}
                  {a.error && <span className="text-danger"> (falhou)</span>}
                </p>
                {a.detail && <p className="truncate font-mono text-[11px] text-muted">{a.detail}</p>}
              </div>
            </div>
          ))}
          {usage && (
            <p
              className="text-[11px] text-muted"
              title="Soma de todas as chamadas ao modelo nesta resposta, incluindo cache"
            >
              Tokens: {formatTokens(usage.inputTokens)} de entrada · {formatTokens(usage.outputTokens)} de saída
            </p>
          )}
          {model && (
            <p className="text-[11px] text-muted" data-testid="message-model">
              Modelo: <span className="font-mono">{model}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Relógio de 1 s enquanto há resposta em andamento (e só então). */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/** Depois deste tempo sem nenhum sinal, o aviso sugere que o Claude pode estar numa etapa longa (ou travado). */
const QUIET_WARNING_S = 45;

export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s`;
}

function LiveStatus({ live, now }: { live: { startedAt: number; lastEventAt: number }; now: number }) {
  const working = Math.max(0, Math.round((now - live.startedAt) / 1000));
  const quiet = Math.max(0, Math.round((now - live.lastEventAt) / 1000));
  return (
    <p className="mt-1 text-[11px] text-muted" data-testid="live-status" aria-live="off">
      Trabalhando há {formatElapsed(working)} · último sinal há {formatElapsed(quiet)}
      {quiet >= QUIET_WARNING_S && (
        <span className="text-amber-500">
          {' '}
          · sem novidades há um tempo: ele pode estar numa etapa longa. Se quiser, use o botão de parar.
        </span>
      )}
    </p>
  );
}

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : String(n);
}
