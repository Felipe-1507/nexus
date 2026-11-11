import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Attachment } from '@shared/chat';
import type { ModelChoice } from '@shared/models';
import type { Workspace } from '@shared/workspace';
import { Markdown } from '@renderer/components/Markdown';
import { ConnectClaude } from '@renderer/features/claude/ConnectClaude';
import { ContextBar } from '@renderer/features/context/ContextBar';
import { ContinueDialog } from '@renderer/features/context/ContinueDialog';
import { ModelPicker, modelName } from '@renderer/features/models/ModelPicker';
import { useSetConversationModel } from '@renderer/features/models/queries';
import { useProjects } from '@renderer/features/projects/queries';
import { WorkspaceAvatar } from '@renderer/features/workspaces/appearance';
import { invoke } from '@renderer/lib/ipc';
import { useLayout } from '@renderer/app/shell/layout-store';
import { useChat } from './chat-store';
import { FileLinkProvider } from './file-link-context';
import { Composer } from './Composer';
import { Details, MessageItem } from './MessageItem';
import { PermissionCard } from './PermissionCard';
import { QuestionCard } from './QuestionCard';
import { SyncButton } from './SyncButton';
import {
  useConversations,
  useDequeueMessage,
  useEnqueueMessage,
  useInterrupt,
  useMessages,
  useSendMessage,
} from './queries';

interface ConversationViewProps {
  workspace: Workspace;
  conversationId: string | null;
  claudeReady: boolean;
}

/** Conversa aberta (ou uma nova, ainda vazia) do Workspace ativo. */
export function ConversationView({ workspace, conversationId, claudeReady }: ConversationViewProps) {
  const messages = useMessages(conversationId);
  const live = useChat((s) => (conversationId ? s.live[conversationId] : undefined));
  const queue = useChat((s) => (conversationId ? (s.queue[conversationId] ?? EMPTY_QUEUE) : EMPTY_QUEUE));
  const queueError = useChat((s) => (conversationId ? s.queueError[conversationId] : undefined));
  const prefill = useChat((s) => (conversationId ? s.prefill[conversationId] : undefined));
  const openNote = useLayout((s) => s.openNote);
  const openCode = useLayout((s) => s.openCode);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [continueOpen, setContinueOpen] = useState(false);
  const enqueue = useEnqueueMessage();
  const dequeue = useDequeueMessage();
  const pending = useChat((s) => (conversationId ? s.pending[conversationId] : undefined));
  const send = useSendMessage();
  const interrupt = useInterrupt();
  const scope = useChat((s) => s.scope[workspace.id] ?? null);
  const project = useProjects(workspace.id).data?.find((p) => p.id === scope);
  const conversation = useConversations(workspace.id, scope).data?.find((c) => c.id === conversationId);
  const setModel = useSetConversationModel(workspace.id);
  // Conversa nova: a escolha fica aqui até a primeira mensagem criar a conversa.
  const [draftChoice, setDraftChoice] = useState<ModelChoice>({ model: null, effort: null });
  const choice: ModelChoice = conversation ? { model: conversation.model, effort: conversation.effort } : draftChoice;
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Acompanha o fim da conversa enquanto o usuário não rolar para cima.
  useEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.data, live?.draft, live?.activities.length]);

  const list = messages.data ?? [];
  // Conversas muito longas mostram só o fim; as anteriores entram sob demanda (mantém a tela leve).
  const [shown, setShown] = useState(PAGE_SIZE);
  useEffect(() => setShown(PAGE_SIZE), [conversationId]);
  const hidden = Math.max(0, list.length - shown);
  const empty = !conversationId || (messages.isSuccess && list.length === 0 && !live);
  // "Desfazer" só na última resposta, e nunca durante uma resposta em andamento.
  const lastAssistantId = live ? undefined : list.findLast((m) => m.role === 'assistant')?.id;

  /** Abre o arquivo citado numa resposta: nota na aba Nota, texto na aba Código, o resto no Explorer. */
  async function openFileLink(target: string): Promise<void> {
    setLinkError(null);
    try {
      const projectId = project?.id ?? null;
      const r = await invoke('code:openLink', { workspaceId: workspace.id, projectId, target });
      if (r.action === 'note' && r.path) openNote(workspace.id, r.path);
      else if (r.action === 'code' && r.path) openCode({ workspaceId: workspace.id, projectId, path: r.path });
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onSend(text: string, attachments: Attachment[]): Promise<boolean> {
    stickToBottom.current = true;
    try {
      // Com o Claude respondendo (ou com outras mensagens na frente), a nova entra na fila e começa quando chegar a vez.
      if (conversationId && (live || queue.length > 0)) {
        await enqueue.mutateAsync({ workspaceId: workspace.id, conversationId, text, attachments });
        return true;
      }
      await send.mutateAsync({
        workspaceId: workspace.id,
        conversationId: conversationId ?? undefined,
        text,
        attachments,
        ...(conversationId ? {} : { ...draftChoice, projectId: scope ?? undefined }),
      });
      return true;
    } catch {
      return false;
    }
  }

  return (
    <FileLinkProvider value={openFileLink}>
      <div className="flex h-full flex-col" data-testid="chat-view">
        {conversationId && (
          <>
            <ContextBar
              workspaceId={workspace.id}
              conversationId={conversationId}
              forkedFrom={conversation?.forkedFrom ?? null}
              running={Boolean(live)}
              onContinue={() => setContinueOpen(true)}
              leading={<SyncButton conversationId={conversationId} disabled={Boolean(live) || queue.length > 0} />}
            />
            <ContinueDialog
              open={continueOpen}
              conversationId={conversationId}
              onClose={() => setContinueOpen(false)}
              onOpenConversation={(next) => {
                setContinueOpen(false);
                useChat.getState().select(workspace.id, next.id);
              }}
            />
          </>
        )}
        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {empty ? (
            <div className="flex h-full items-center justify-center p-8">
              <div className="max-w-md text-center">
                <div className="mb-5 flex justify-center">
                  <WorkspaceAvatar color={workspace.color} icon={workspace.icon} size="lg" />
                </div>
                <h1 className="text-xl font-semibold tracking-tight">{project ? project.name : workspace.name}</h1>
                <p className="mt-2 text-sm leading-6 text-muted">
                  {project ? (
                    <>
                      Comece uma conversa sobre este projeto. O Claude trabalha em{' '}
                      <span className="font-mono text-xs break-all">{project.path}</span> e segue as instruções dele e
                      do Workspace {workspace.name}.
                    </>
                  ) : (
                    'Comece uma conversa. O Claude trabalha na pasta deste Workspace e segue as instruções dele.'
                  )}
                </p>
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-6 px-6 py-8" aria-live="polite">
              {messages.isError && (
                <p role="alert" className="text-sm text-danger">
                  {messages.error.message}
                </p>
              )}
              {hidden > 0 && (
                <button
                  type="button"
                  data-testid="show-earlier"
                  onClick={() => setShown((n) => n + PAGE_SIZE)}
                  className="mx-auto block rounded-md border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
                >
                  Mostrar mensagens anteriores ({hidden})
                </button>
              )}
              {list.slice(hidden).map((m) => (
                <MessageItem key={m.id} message={m} workspaceId={workspace.id} canUndo={m.id === lastAssistantId} />
              ))}
              {live && (
                <div data-testid="message-live">
                  {live.draft ? <Markdown>{live.draft}</Markdown> : <Thinking />}
                  <Details activities={live.activities} live={live} />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mx-auto w-full max-w-3xl px-6 pb-6">
          <ConnectClaude className="mb-3" />
          {pending?.[0] &&
            (pending[0].questions ? (
              <QuestionCard key={pending[0].id} request={pending[0]} queued={pending.length - 1} />
            ) : (
              <PermissionCard request={pending[0]} queued={pending.length - 1} />
            ))}
          {conversationId && (queue.length > 0 || queueError) && (
            <QueueList
              items={queue}
              error={queueError}
              onRemove={(id) => dequeue.mutate({ conversationId, id })}
              onDismissError={() => useChat.getState().clearQueueError(conversationId)}
            />
          )}
          {linkError && (
            <p role="alert" className="mb-2 flex items-center gap-2 text-xs text-danger">
              <span className="min-w-0 flex-1">{linkError}</span>
              <button
                type="button"
                aria-label="Fechar aviso"
                onClick={() => setLinkError(null)}
                className="text-muted hover:text-text"
              >
                <X size={13} />
              </button>
            </p>
          )}
          {send.isError && (
            <p role="alert" className="mb-2 text-xs text-danger">
              {send.error.message}
            </p>
          )}
          <Composer
            placeholder={`Conversar em ${project ? project.name : workspace.name}…`}
            disabled={!claudeReady}
            disabledReason="O Claude Code não está disponível"
            running={Boolean(live)}
            workspaceId={workspace.id}
            prefill={prefill}
            draftKey={conversationId ?? `new:${workspace.id}:${scope ?? ''}`}
            onSend={onSend}
            onStop={() => conversationId && interrupt.mutate(conversationId)}
            footer={
              <ModelPicker
                value={choice}
                disabled={!claudeReady}
                inheritedLabel={(catalog) =>
                  workspace.defaultModel
                    ? `${modelName(catalog, workspace.defaultModel)} · padrão do Workspace`
                    : `Padrão${catalog?.defaultModel ? ` (${catalog.defaultModel.displayName})` : ''}`
                }
                onChange={(next) =>
                  conversationId ? setModel.mutate({ conversationId, ...next }) : setDraftChoice(next)
                }
              />
            }
          />
        </div>
      </div>
    </FileLinkProvider>
  );
}

/** Único sinal visível enquanto o Claude trabalha (modo minimalista). */
function Thinking() {
  return (
    <p className="flex items-center gap-2 text-sm text-muted" data-testid="thinking">
      <span className="thinking-dot size-1.5 rounded-full bg-accent" />
      <span>
        Pensando
        <span className="thinking-ellipsis" aria-hidden />
      </span>
    </p>
  );
}

const EMPTY_QUEUE: never[] = [];
const PAGE_SIZE = 100;

/** Mensagens que o usuário já escreveu e que esperam a resposta atual terminar. */
function QueueList({
  items,
  error,
  onRemove,
  onDismissError,
}: {
  items: Array<{ id: string; text: string; attachments: number }>;
  error?: string;
  onRemove: (id: string) => void;
  onDismissError: () => void;
}) {
  return (
    <div className="mb-2 space-y-1" data-testid="message-queue">
      {items.map((item, i) => (
        <div
          key={item.id}
          className="flex items-center gap-2 rounded-xl border border-dashed border-border bg-surface px-3 py-1.5 text-xs"
        >
          <span className="shrink-0 text-muted">Na fila{items.length > 1 ? ` (${i + 1})` : ''}</span>
          <span className="min-w-0 flex-1 truncate">
            {item.text || 'Anexos'}
            {item.attachments > 0 && item.text && (
              <span className="text-muted">
                {' '}
                + {item.attachments} {item.attachments === 1 ? 'anexo' : 'anexos'}
              </span>
            )}
          </span>
          <button
            type="button"
            aria-label={`Tirar da fila: ${item.text.slice(0, 40)}`}
            onClick={() => onRemove(item.id)}
            className="rounded p-0.5 text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
          >
            <X size={13} />
          </button>
        </div>
      ))}
      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs"
        >
          <span className="min-w-0 flex-1">Uma mensagem da fila não pôde ser enviada: {error}</span>
          <button
            type="button"
            aria-label="Fechar aviso"
            onClick={onDismissError}
            className="text-muted hover:text-text"
          >
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
