import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type {
  Attachment,
  ChatEvent,
  ChatMessage,
  Conversation,
  QueuedMessage,
  SendMessageInput,
  SendMessageResult,
} from '@shared/chat';
import type { ClaudeStatus } from '@shared/claude';
import type { FileChange } from '@shared/code';
import {
  CACHE_WARN_MIN_TOKENS,
  STRUCTURED_SUMMARY_INSTRUCTIONS,
  type ContextState,
  type ContinuationPreview,
  type ContinueResult,
} from '@shared/context';
import { NexusError } from '@shared/ipc-result';
import { effortSchema, type ModelChoice } from '@shared/models';
import type { ClaudeSessionSummary } from '@shared/project';
import type { Workspace } from '@shared/workspace';
import type { SessionConfig, SessionManager, TurnHandlers } from '../../agent/session-manager';
import { convertTranscript, selectNewMessages, type TranscriptMessage } from '../../agent/transcript-import';
import type { TurnOutcome } from '../../agent/turn-accumulator';
import { ConversationsRepo, type ConversationRow } from '../../persistence/repositories/conversations-repo';
import { composeSystemPrompt, summarizeInstructions } from '../context/context-composer';
import type { KnowledgeService } from '../knowledge/knowledge-service';
import type { AttachmentService } from './attachment-service';
import { ContextService } from './context-service';
import type { PermissionsService } from '../permissions/permissions-service';
import type { ProjectService } from '../projects/project-service';
import { KNOWLEDGE_DIR, type WorkspaceService } from '../workspaces/workspace-service';

/** Acesso às conversas que o Claude Code já gravou numa pasta (para importar). */
export interface TranscriptSource {
  list: (dir: string) => Promise<Array<{ sessionId: string; summary: string; lastModified: number }>>;
  messages: (sessionId: string, dir: string) => Promise<TranscriptMessage[]>;
}

/** Cópia de sessões do Claude Code (o `forkSession` do SDK é uma cópia local do arquivo, sem processo nem API). */
export interface SessionForker {
  fork: (sessionId: string, dir: string, title: string) => Promise<string>;
  remove: (sessionId: string, dir: string) => Promise<void>;
  /** Troca o título da sessão no Claude Code (é o nome que o VS Code mostra). */
  rename?: (sessionId: string, dir: string, title: string) => Promise<void>;
}

export interface ChatServiceDeps {
  db: DatabaseSync;
  /** Necessário para "Continuar em nova conversa". */
  forker?: SessionForker;
  workspaces: WorkspaceService;
  projects: Pick<ProjectService, 'get' | 'sessionSettings' | 'list'>;
  /** Segundo cérebro do Workspace (índice que vai ao prompt). */
  knowledge: Pick<KnowledgeService, 'promptSection'>;
  /** Arquivos colados ou arrastados no chat. */
  attachments: Pick<AttachmentService, 'pathOf' | 'dir'>;
  permissions: Pick<PermissionsService, 'canUseToolFor' | 'cancelConversation'>;
  sessions: Pick<SessionManager, 'startTurn' | 'interrupt' | 'isRunning' | 'rewind' | 'hasSession' | 'close'> &
    Partial<Pick<SessionManager, 'onSpontaneousTurn'>>;
  getClaude: () => Promise<ClaudeStatus>;
  /** Instruções gerais do usuário (primeira camada do contexto). */
  globalInstructions: () => string;
  transcripts: TranscriptSource;
  emit: (event: ChatEvent) => void;
  /** Modelo fixo (testes); sem valor, vale a escolha da conversa ou os padrões. */
  model?: string;
  onError?: (message: string, error: unknown) => void;
  newId?: () => string;
  now?: () => string;
}

const TITLE_MAX = 60;
/** A compactação de uma conversa grande lê o contexto inteiro uma vez; ela pode demorar. */
const COMPACTION_TIMEOUT_MS = 15 * 60_000;
/** Comparar o prompt de uma conversa de projeto lê a pasta dele (às vezes em rede): não vale esperar muito. */
const PROMPT_CHECK_TIMEOUT_MS = 4000;

export class ChatService {
  private readonly repo: ConversationsRepo;
  private readonly newId: () => string;
  private readonly now: () => string;
  /** Medidor de contexto das conversas (usado também pelos canais `context:*`). */
  readonly context: ContextService;
  /** Conversas com um "Continuar em nova conversa" em andamento (impede repetir o pedido). */
  private readonly continuing = new Set<string>();
  /** Conversas sendo sincronizadas com a transcrição agora (evita duas leituras ao mesmo tempo). */
  private readonly syncing = new Set<string>();

  constructor(private readonly deps: ChatServiceDeps) {
    this.repo = new ConversationsRepo(deps.db);
    this.newId = deps.newId ?? randomUUID;
    this.now = deps.now ?? (() => new Date().toISOString());
    this.context = new ContextService({
      db: deps.db,
      isRunning: (id) => deps.sessions.isRunning(id),
      now: this.now,
      newId: this.newId,
    });
    deps.sessions.onSpontaneousTurn?.((conversationId) => this.beginSpontaneousTurn(conversationId));
  }

  /**
   * Resposta que o Claude Code começa sozinho (o aviso de que uma tarefa em segundo plano terminou). Vira uma mensagem
   * do Claude na conversa, como qualquer outra; sem nada para mostrar, é descartada.
   */
  private beginSpontaneousTurn(conversationId: string): TurnHandlers | null {
    if (!this.repo.findConversation(conversationId)) return null;
    const assistantMessageId = this.newId();
    this.deps.emit({ type: 'spontaneous-start', conversationId, assistantMessageId });
    return {
      onEvent: (event) => this.deps.emit({ ...event, conversationId, assistantMessageId }),
      onSessionId: (sessionId) => this.repo.setSessionId(conversationId, sessionId),
      onDone: (outcome) => {
        if (!outcome.content.trim() && outcome.activities.length === 0) {
          this.deps.emit({ type: 'turn-discard', conversationId });
          void this.drain(conversationId);
          return;
        }
        this.finishTurn(conversationId, assistantMessageId, outcome, true, null);
      },
    };
  }

  /** Grava a resposta do turno, registra a medição, avisa a tela e deixa a fila andar. */
  private finishTurn(
    conversationId: string,
    assistantMessageId: string,
    outcome: TurnOutcome,
    resumed: boolean,
    promptHash: string | null,
  ): void {
    try {
      const message = this.repo.insertMessage({
        id: assistantMessageId,
        conversationId,
        role: 'assistant',
        content: outcome.content,
        status: outcome.status,
        error: outcome.error,
        activities: outcome.activities,
        usage: outcome.usage,
        model: outcome.model,
        createdAt: this.now(),
      });
      this.repo.insertFileChanges(assistantMessageId, outcome.fileChanges);
      this.repo.touch(conversationId, message.createdAt);
      this.recordContext(conversationId, outcome, resumed, promptHash);
      this.deps.emit({ type: 'turn-end', conversationId, message });
    } catch (err) {
      this.deps.onError?.('Falha ao gravar a resposta', err);
    }
    // Com a resposta gravada, a próxima mensagem da fila (se houver) começa.
    void this.drain(conversationId);
  }

  /** `projectId`: `null` = conversas gerais do Workspace; um id = as do projeto; ausente = todas. */
  listConversations(workspaceId: string, projectId?: string | null): Conversation[] {
    this.deps.workspaces.get(workspaceId);
    return this.repo.listByWorkspace(workspaceId, projectId).map((r) => this.toConversation(r));
  }

  listMessages(conversationId: string): ChatMessage[] {
    this.requireConversation(conversationId);
    return this.repo.listMessages(conversationId);
  }

  archive(conversationId: string): void {
    this.requireConversation(conversationId);
    if (this.deps.sessions.isRunning(conversationId)) {
      throw new NexusError('CONFLICT', 'Pare a resposta em andamento antes de arquivar a conversa.');
    }
    this.queues.delete(conversationId);
    this.repo.archive(conversationId, this.now());
  }

  /**
   * Troca o nome da conversa. O nome também é gravado na sessão do Claude Code (como o "Rename" do VS Code); se essa
   * gravação falhar, o nome do Nexus vale mesmo assim. Não mexe na ordem da lista.
   */
  async rename(conversationId: string, title: string): Promise<Conversation> {
    const row = this.requireConversation(conversationId);
    const clean = title.replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!clean) throw new NexusError('VALIDATION', 'Dê um nome à conversa.');
    this.repo.rename(conversationId, clean);
    if (row.claudeSessionId && this.deps.forker?.rename) {
      await this.deps.forker.rename(row.claudeSessionId, row.cwd, clean).catch(() => undefined);
    }
    return this.toConversation(this.requireConversation(conversationId));
  }

  /** Mensagens esperando a vez, por conversa. Ficam só na memória: uma fila antiga não deve reaparecer depois de um reinício. */
  private readonly queues = new Map<string, Array<{ id: string; input: SendMessageInput }>>();
  /** Conversas em que uma mensagem da fila está sendo iniciada agora (evita iniciar duas ao mesmo tempo). */
  private readonly draining = new Set<string>();

  /**
   * Mensagem enviada enquanto o Claude responde (ou com outras na frente): entra na fila e começa quando a anterior
   * terminar. Só vale para conversas que já existem (uma conversa nova ainda não pode estar respondendo).
   */
  enqueue(input: {
    workspaceId: string;
    conversationId: string;
    text: string;
    attachments?: Attachment[];
  }): QueuedMessage[] {
    const conversation = this.requireConversation(input.conversationId);
    if (conversation.workspaceId !== input.workspaceId) throw new NexusError('NOT_FOUND', 'Conversa não encontrada.');
    const queue = this.queues.get(conversation.id) ?? [];
    queue.push({ id: this.newId(), input });
    this.queues.set(conversation.id, queue);
    this.emitQueue(conversation.id);
    // Se nada está respondendo agora, a mensagem começa na hora.
    void this.drain(conversation.id);
    return this.queued(conversation.id);
  }

  /** Anexos em uso no Workspace: os de mensagens já enviadas e os de mensagens que ainda esperam na fila. */
  attachmentsInUse(workspaceId: string): { sent: Set<string>; queued: Set<string> } {
    const queued = new Set<string>();
    for (const queue of this.queues.values()) {
      for (const q of queue) {
        if (q.input.workspaceId === workspaceId) for (const a of q.input.attachments ?? []) queued.add(a.id);
      }
    }
    return { sent: this.repo.listAttachmentIds(workspaceId), queued };
  }

  /** Tira uma mensagem da fila (o usuário desistiu dela). */
  dequeue(conversationId: string, id: string): QueuedMessage[] {
    this.requireConversation(conversationId);
    const queue = this.queues.get(conversationId);
    const index = queue?.findIndex((q) => q.id === id) ?? -1;
    if (queue && index >= 0) queue.splice(index, 1);
    this.emitQueue(conversationId);
    return this.queued(conversationId);
  }

  /** Todas as filas não vazias (a tela recarregada recompõe a fila a partir daqui). */
  allQueued(): Array<{ conversationId: string; items: QueuedMessage[] }> {
    return [...this.queues.keys()]
      .map((conversationId) => ({ conversationId, items: this.queued(conversationId) }))
      .filter((q) => q.items.length > 0);
  }

  private queued(conversationId: string): QueuedMessage[] {
    return (this.queues.get(conversationId) ?? []).map((q) => ({
      id: q.id,
      text: q.input.text,
      attachments: q.input.attachments?.length ?? 0,
    }));
  }

  private emitQueue(conversationId: string, error?: string): void {
    this.deps.emit({ type: 'queue', conversationId, items: this.queued(conversationId), ...(error ? { error } : {}) });
  }

  /** Inicia a próxima mensagem da fila, se nada estiver respondendo. */
  private async drain(conversationId: string): Promise<void> {
    if (this.draining.has(conversationId)) return;
    this.draining.add(conversationId);
    try {
      while (!this.deps.sessions.isRunning(conversationId)) {
        const next = this.queues.get(conversationId)?.shift();
        if (!next) break;
        try {
          const started = await this.send(next.input);
          this.emitQueue(conversationId);
          this.deps.emit({
            type: 'turn-start',
            conversationId,
            userMessage: started.userMessage,
            assistantMessageId: started.assistantMessageId,
          });
        } catch (err) {
          // A mensagem não se perde: volta ao início da fila e o envio para até o usuário resolver (ou remover).
          const queue = this.queues.get(conversationId) ?? [];
          queue.unshift(next);
          this.queues.set(conversationId, queue);
          this.emitQueue(conversationId, err instanceof Error ? err.message : String(err));
          break;
        }
      }
    } finally {
      this.draining.delete(conversationId);
    }
  }

  interrupt(conversationId: string): Promise<void> {
    this.requireConversation(conversationId);
    // Pedidos de permissão pendentes desta conversa são negados antes de parar.
    this.deps.permissions.cancelConversation(conversationId);
    return this.deps.sessions.interrupt(conversationId);
  }

  /**
   * Grava a mensagem do usuário e inicia a resposta. Retorna logo: o texto chega depois pelos eventos
   * `chat:event`, e a resposta final é gravada quando o turno termina.
   */
  async send(input: SendMessageInput): Promise<SendMessageResult> {
    const workspace = this.deps.workspaces.get(input.workspaceId);
    if (workspace.folderStatus === 'missing') {
      throw new NexusError('VALIDATION', 'A pasta deste Workspace não foi encontrada no disco.');
    }
    const claude = await this.requireClaude();

    let conversation: ConversationRow;
    let isNew = false;
    if (input.conversationId) {
      conversation = this.requireConversation(input.conversationId);
      // Isolamento: uma conversa só pode ser usada a partir do Workspace dono dela.
      if (conversation.workspaceId !== workspace.id) throw new NexusError('NOT_FOUND', 'Conversa não encontrada.');
      if (this.deps.sessions.isRunning(conversation.id)) {
        throw new NexusError('CONFLICT', 'Aguarde a resposta atual terminar.');
      }
    } else {
      let cwd = workspace.rootPath;
      if (input.projectId) {
        const project = await this.deps.projects.get(input.projectId);
        if (project.workspaceId !== workspace.id) throw new NexusError('NOT_FOUND', 'Projeto não encontrado.');
        cwd = project.path;
      }
      const now = this.now();
      isNew = true;
      conversation = {
        id: this.newId(),
        workspaceId: workspace.id,
        projectId: input.projectId ?? null,
        title: titleFrom(input.text || input.attachments?.[0]?.name || 'Anexos'),
        cwd,
        claudeSessionId: null,
        model: input.model ?? null,
        effort: input.effort ?? null,
        createdAt: now,
        updatedAt: now,
      };
    }

    // Anexos conferidos antes de gravar qualquer coisa: um que sumiu recusa o envio inteiro.
    const attachments = input.attachments ?? [];
    const attachmentFiles = attachments.map((a) => ({
      name: a.name,
      file: this.deps.attachments.pathOf(workspace.id, a),
    }));

    // Antes de gravar qualquer coisa: se a pasta do projeto não responde, nada fica pela metade.
    const config = await this.sessionConfig(workspace, conversation, claude);
    if (isNew) this.repo.insertConversation(conversation);

    const userMessage = this.repo.insertMessage({
      id: this.newId(),
      conversationId: conversation.id,
      role: 'user',
      content: input.text,
      status: 'complete',
      error: null,
      activities: [],
      attachments,
      usage: null,
      model: null,
      createdAt: this.now(),
    });
    this.repo.touch(conversation.id, userMessage.createdAt);

    const conversationId = conversation.id;
    const assistantMessageId = this.newId();
    // Para o medidor: a conversa já tinha sessão (retomada) e qual prompt do sistema vai nesta chamada.
    const resumed = Boolean(conversation.claudeSessionId);
    const promptHash = hashPrompt(config.systemPromptAppend);
    this.deps.sessions.startTurn(
      conversationId,
      config,
      { uuid: userMessage.id, text: promptWithAttachments(input.text, attachmentFiles) },
      {
        onEvent: (event) => this.deps.emit({ ...event, conversationId, assistantMessageId }),
        onSessionId: (sessionId) => this.repo.setSessionId(conversationId, sessionId),
        onDone: (outcome) => this.finishTurn(conversationId, assistantMessageId, outcome, resumed, promptHash),
      },
    );

    return {
      conversation: this.toConversation(this.repo.findConversation(conversationId)!),
      userMessage,
      assistantMessageId,
    };
  }

  /** Alterações de arquivos de uma resposta (antes e depois), para o diff. */
  fileChanges(messageId: string): FileChange[] {
    return this.repo.listFileChanges(messageId);
  }

  /** Troca o modelo/esforço da conversa; vale a partir da próxima mensagem (a sessão é reaberta e continua). */
  setModel(conversationId: string, choice: ModelChoice): Conversation {
    this.requireConversation(conversationId);
    this.repo.setModel(conversationId, choice.model, choice.effort);
    return this.toConversation(this.requireConversation(conversationId));
  }

  /**
   * Desfaz as alterações de arquivos da última resposta, voltando os arquivos ao estado de antes da mensagem
   * que a originou (checkpoint do Claude Code). Com `dryRun`, só informa quais arquivos seriam restaurados.
   * Comandos executados (ex.: instalar pacotes) não são desfeitos.
   */
  async undo(conversationId: string, messageId: string, dryRun: boolean): Promise<{ files: string[] }> {
    const conversation = this.requireConversation(conversationId);
    const messages = this.repo.listMessages(conversationId);
    const index = messages.findIndex((m) => m.id === messageId);
    const message = messages[index];
    if (!message || message.role !== 'assistant') throw new NexusError('NOT_FOUND', 'Resposta não encontrada.');
    if (messages.findLast((m) => m.role === 'assistant')?.id !== messageId) {
      throw new NexusError('VALIDATION', 'Só é possível desfazer a última resposta.');
    }
    if (message.undoneAt) throw new NexusError('VALIDATION', 'As alterações desta resposta já foram desfeitas.');
    if (!message.activities.some((a) => a.changedFile)) {
      throw new NexusError('VALIDATION', 'Esta resposta não alterou arquivos.');
    }
    const userMessage = messages.slice(0, index).findLast((m) => m.role === 'user');
    if (!userMessage) throw new NexusError('NOT_FOUND', 'Mensagem de origem não encontrada.');

    const workspace = this.deps.workspaces.get(conversation.workspaceId);
    const claude = await this.requireClaude();
    const result = await this.deps.sessions.rewind(
      conversationId,
      await this.sessionConfig(workspace, conversation, claude),
      userMessage.id,
      dryRun,
    );
    if (!result.canRewind) throw new NexusError('VALIDATION', result.error ?? 'Não foi possível desfazer.');
    if (!dryRun) this.repo.markUndone(messageId, this.now());
    return { files: result.filesChanged ?? [] };
  }

  /** Conversas que o Claude Code já tem na pasta do projeto (feitas no terminal ou no VS Code). */
  async listClaudeSessions(projectId: string): Promise<ClaudeSessionSummary[]> {
    const project = await this.deps.projects.get(projectId);
    if (project.status !== 'ok') throw new NexusError('VALIDATION', 'A pasta do projeto não está acessível.');
    const sessions = await this.deps.transcripts.list(project.path);
    return sessions
      .map((s) => ({ ...s, imported: Boolean(this.repo.findBySessionId(s.sessionId)) }))
      .sort((a, b) => b.lastModified - a.lastModified);
  }

  /**
   * Traz uma conversa do Claude Code para o Nexus: as últimas mensagens viram histórico visível e a conversa
   * continua na mesma sessão (o Claude lembra de tudo, inclusive do que não foi importado).
   */
  async importSession(projectId: string, sessionId: string): Promise<Conversation> {
    const project = await this.deps.projects.get(projectId);
    if (this.repo.findBySessionId(sessionId)) {
      throw new NexusError('VALIDATION', 'Esta conversa já foi importada.');
    }
    const summary = (await this.deps.transcripts.list(project.path)).find((s) => s.sessionId === sessionId);
    if (!summary) throw new NexusError('NOT_FOUND', 'Conversa do Claude Code não encontrada nesta pasta.');
    const messages = convertTranscript(await this.deps.transcripts.messages(sessionId, project.path));

    const now = this.now();
    const conversation: ConversationRow = {
      id: this.newId(),
      workspaceId: project.workspaceId,
      projectId: project.id,
      title: titleFrom(summary.summary || 'Conversa importada'),
      cwd: project.path,
      claudeSessionId: sessionId,
      model: null,
      effort: null,
      createdAt: now,
      updatedAt: now,
    };
    this.repo.insertConversation(conversation);
    for (const m of messages) {
      this.repo.insertMessage({
        id: m.id,
        conversationId: conversation.id,
        role: m.role,
        content: m.content,
        status: 'complete',
        error: null,
        activities: m.activities,
        usage: null,
        model: null,
        createdAt: now,
      });
    }
    return this.toConversation(conversation);
  }

  /**
   * Traz para a tela as mensagens que a sessão ganhou fora do Nexus (VS Code, terminal) depois da última vez. O Claude
   * já lembra de tudo, porque a sessão é a mesma; isto só atualiza o histórico visível. Nunca altera a sessão.
   */
  async syncFromClaudeCode(conversationId: string): Promise<{ added: number }> {
    const row = this.requireConversation(conversationId);
    if (!row.claudeSessionId) {
      throw new NexusError('VALIDATION', 'Esta conversa ainda não tem uma sessão do Claude Code para sincronizar.');
    }
    const busy = () =>
      this.deps.sessions.isRunning(conversationId) || (this.queues.get(conversationId)?.length ?? 0) > 0;
    if (busy()) throw new NexusError('CONFLICT', 'Aguarde a resposta atual terminar para sincronizar.');
    if (this.syncing.has(conversationId)) throw new NexusError('CONFLICT', 'A sincronização já está em andamento.');
    this.syncing.add(conversationId);
    try {
      const raw = await this.deps.transcripts.messages(row.claudeSessionId, row.cwd);
      if (busy())
        throw new NexusError('CONFLICT', 'Uma resposta começou durante a sincronização. Tente de novo ao terminar.');
      const known = this.repo.listMessages(conversationId).map((m) => ({ id: m.id, role: m.role }));
      const fresh = selectNewMessages(convertTranscript(raw, 500), known);
      if (fresh.length === 0) return { added: 0 };
      const at = this.now();
      this.transaction(() => {
        for (const m of fresh) {
          this.repo.insertMessage({
            id: m.id,
            conversationId,
            role: m.role,
            content: m.content,
            status: 'complete',
            error: null,
            activities: m.activities,
            usage: null,
            model: null,
            createdAt: at,
          });
        }
        this.repo.touch(conversationId, at);
      });
      return { added: fresh.length };
    } finally {
      this.syncing.delete(conversationId);
    }
  }

  private recordContext(
    conversationId: string,
    outcome: TurnOutcome,
    resumed: boolean,
    promptHash: string | null,
  ): void {
    try {
      this.context.recordTurn({
        conversationId,
        context: outcome.context ?? null,
        model: outcome.model,
        compaction: outcome.compaction ?? null,
        windowTokens: outcome.windowTokens ?? null,
        costUsd: outcome.costUsd ?? null,
        resumed,
        promptHash,
      });
    } catch (err) {
      // A medição nunca atrapalha a resposta.
      this.deps.onError?.('Falha ao gravar a medição de contexto', err);
    }
  }

  /** Medição da conversa e, se ela for grande, se o prompt do sistema de hoje difere do último enviado. */
  async contextState(conversationId: string): Promise<ContextState> {
    const row = this.requireConversation(conversationId);
    const snapshot = await this.context.snapshotFresh(row);
    let promptChanged: boolean | null = null;
    const big = (snapshot?.contextTokens ?? 0) >= CACHE_WARN_MIN_TOKENS;
    // Com um processo aberto, o prompt é o que ele já tem: reabrir só acontece depois que ele fecha.
    if (big && !this.deps.sessions.hasSession(conversationId)) {
      const stored = this.context.storedPromptHash(conversationId);
      if (stored) promptChanged = await this.promptChanged(row, stored);
    }
    return { snapshot, thresholds: this.context.thresholds(), promptChanged };
  }

  private async promptChanged(row: ConversationRow, stored: string): Promise<boolean | null> {
    try {
      const workspace = this.deps.workspaces.get(row.workspaceId);
      const claude = await this.deps.getClaude();
      const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), PROMPT_CHECK_TIMEOUT_MS).unref());
      const config = await Promise.race([this.sessionConfig(workspace, row, claude), timeout]);
      return config ? hashPrompt(config.systemPromptAppend) !== stored : null;
    } catch {
      return null;
    }
  }

  /** Continuação desta conversa feita depois da última atividade dela (uma repetição do pedido não cria outra). */
  private existingContinuation(source: ConversationRow): ConversationRow | undefined {
    const found = this.repo.findContinuationOf(source.id);
    return found && found.createdAt >= source.updatedAt ? found : undefined;
  }

  async continuationPreview(conversationId: string): Promise<ContinuationPreview> {
    const row = this.requireConversation(conversationId);
    const existing = this.existingContinuation(row);
    return {
      conversationId,
      title: row.title,
      snapshot: await this.context.snapshotFresh(row),
      existing: existing ? this.toConversation(existing) : null,
      running: this.deps.sessions.isRunning(conversationId),
    };
  }

  /**
   * "Continuar em nova conversa": copia a sessão do Claude Code (`forkSession`, cópia local), compacta SÓ a cópia com o
   * `/compact` nativo e cria uma conversa nova apontando para ela. A sessão original nunca é aberta nem alterada.
   * Qualquer falha cancela tudo: a cópia é apagada e nenhuma conversa é criada. Repetir o pedido devolve a mesma
   * continuação, e dois pedidos ao mesmo tempo não são aceitos.
   */
  async continueInNewConversation(input: {
    conversationId: string;
    structuredSummary: boolean;
  }): Promise<ContinueResult> {
    const source = this.requireConversation(input.conversationId);
    const forker = this.deps.forker;
    if (!forker) throw new NexusError('INTERNAL', 'A cópia de sessões não está disponível.');
    if (this.continuing.has(source.id)) {
      throw new NexusError('CONFLICT', 'Já existe uma continuação em andamento para esta conversa.');
    }
    if (this.deps.sessions.isRunning(source.id) || (this.queues.get(source.id)?.length ?? 0) > 0) {
      throw new NexusError('CONFLICT', 'Aguarde a resposta atual terminar (e a fila esvaziar).');
    }
    const sourceSession = source.claudeSessionId;
    if (!sourceSession) {
      throw new NexusError('VALIDATION', 'Esta conversa ainda não tem histórico no Claude Code para continuar.');
    }
    const duplicate = this.existingContinuation(source);
    if (duplicate) {
      const last = this.repo.listMessages(duplicate.id)[0];
      return {
        conversation: this.toConversation(duplicate),
        compaction: { preTokens: 0, postTokens: null, durationMs: null, costUsd: null },
        summaryShown: Boolean(last),
        alreadyExisted: true,
      };
    }
    const workspace = this.deps.workspaces.get(source.workspaceId);
    if (workspace.folderStatus === 'missing') {
      throw new NexusError('VALIDATION', 'A pasta deste Workspace não foi encontrada no disco.');
    }
    const claude = await this.requireClaude();

    this.continuing.add(source.id);
    const newConversationId = this.newId();
    let forkId: string | null = null;
    try {
      const title = continuationTitle(source.title);
      forkId = await forker.fork(sourceSession, source.cwd, title);
      const createdAt = this.now();
      const draft: ConversationRow = {
        id: newConversationId,
        workspaceId: source.workspaceId,
        projectId: source.projectId,
        title,
        cwd: source.cwd,
        claudeSessionId: forkId,
        model: source.model,
        effort: source.effort,
        createdAt,
        updatedAt: createdAt,
        forkedFrom: source.id,
      };
      const config = await this.sessionConfig(workspace, draft, claude);
      const command = input.structuredSummary ? `/compact ${STRUCTURED_SUMMARY_INSTRUCTIONS}` : '/compact';
      const outcome = await this.runCompaction(newConversationId, config, command);
      if (outcome.status !== 'complete' || !outcome.compaction) {
        throw new NexusError(
          'INTERNAL',
          outcome.error ?? (outcome.content.trim() || 'O Claude Code não concluiu a compactação.'),
        );
      }
      const compaction = outcome.compaction;
      const summary = input.structuredSummary ? extractSummary(outcome.summaryText ?? null) : null;
      const finalSession = outcome.sessionId ?? forkId;

      const promptHash = hashPrompt(config.systemPromptAppend);
      this.transaction(() => {
        this.repo.insertConversation({ ...draft, claudeSessionId: finalSession });
        this.repo.insertMessage({
          id: this.newId(),
          conversationId: newConversationId,
          role: 'assistant',
          content: continuationNotice(source.title, compaction, summary),
          status: 'complete',
          error: null,
          activities: [],
          usage: null,
          model: null,
          createdAt: this.now(),
        });
        this.context.recordCompaction({
          conversationId: newConversationId,
          sourceConversationId: source.id,
          compaction,
          model: outcome.model,
          windowTokens: outcome.windowTokens ?? null,
          costUsd: outcome.costUsd ?? null,
          promptHash,
        });
      });
      return {
        conversation: this.toConversation(this.repo.findConversation(newConversationId)!),
        compaction: {
          preTokens: compaction.preTokens,
          postTokens: compaction.postTokens,
          durationMs: compaction.durationMs,
          costUsd: outcome.costUsd ?? null,
        },
        summaryShown: summary !== null,
        alreadyExisted: false,
      };
    } catch (err) {
      // Nada fica pela metade: fecha o processo da cópia e apaga a cópia (nunca a sessão de origem).
      this.deps.sessions.close(newConversationId, 'Continuação cancelada.');
      if (forkId && forkId !== sourceSession) {
        await forker
          .remove(forkId, source.cwd)
          .catch((e: unknown) => this.deps.onError?.('Falha ao apagar a cópia', e));
      }
      if (err instanceof NexusError) throw err;
      throw new NexusError(
        'INTERNAL',
        `Não foi possível continuar a conversa: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.continuing.delete(source.id);
    }
  }

  /** Envia o `/compact` à cópia e espera o resultado. Passado o limite de tempo, interrompe e falha. */
  private runCompaction(
    conversationId: string,
    config: SessionConfig,
    text: string,
  ): Promise<TurnOutcome & { sessionId: string | null }> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let sessionId: string | null = null;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        void this.deps.sessions.interrupt(conversationId).catch(() => undefined);
        reject(new NexusError('INTERNAL', 'A compactação passou de 15 minutos e foi interrompida.'));
      }, COMPACTION_TIMEOUT_MS);
      timer.unref();
      try {
        this.deps.sessions.startTurn(
          conversationId,
          config,
          { uuid: this.newId(), text },
          {
            onEvent: () => undefined,
            onSessionId: (id) => {
              sessionId = id;
            },
            onDone: (outcome) => {
              clearTimeout(timer);
              if (settled) return;
              settled = true;
              resolve({ ...outcome, sessionId });
            },
          },
        );
      } catch (err) {
        clearTimeout(timer);
        settled = true;
        reject(err);
      }
    });
  }

  private transaction(fn: () => void): void {
    this.deps.db.exec('BEGIN');
    try {
      fn();
      this.deps.db.exec('COMMIT');
    } catch (err) {
      this.deps.db.exec('ROLLBACK');
      throw err;
    }
  }

  private async sessionConfig(
    workspace: Workspace,
    conversation: ConversationRow,
    claude: ClaudeStatus,
  ): Promise<SessionConfig> {
    let instructions = '';
    try {
      instructions = this.deps.workspaces.readInstructions(workspace.id).content;
    } catch (err) {
      this.deps.onError?.('Não foi possível ler o workspace.md', err);
    }

    let project: Parameters<typeof composeSystemPrompt>[0]['project'];
    let settingSources: SessionConfig['settingSources'];
    let additionalDirectories: string[] | undefined;
    const roots = [conversation.cwd];
    if (conversation.projectId) {
      const settings = await this.deps.projects.sessionSettings(conversation.projectId);
      const knowledgeDir = path.join(workspace.rootPath, KNOWLEDGE_DIR);
      project = {
        name: settings.project.name,
        path: settings.project.path,
        instructions: settings.project.instructions,
        knowledgeDir,
      };
      settingSources = settings.settingSources;
      const attachmentsDir = this.deps.attachments.dir(workspace.id);
      additionalDirectories = [knowledgeDir, attachmentsDir];
      roots.push(knowledgeDir, attachmentsDir);
    }

    // Conversa geral: lista os projetos do Workspace, para o Claude saber quais existem.
    let projectList: Parameters<typeof composeSystemPrompt>[0]['projects'];
    if (!conversation.projectId) {
      try {
        projectList = (await this.deps.projects.list(workspace.id)).map((p) => ({
          name: p.name,
          path: p.path,
          summary: summarizeInstructions(p.instructions),
          available: p.status === 'ok',
        }));
      } catch (err) {
        this.deps.onError?.('Não foi possível listar os projetos', err);
      }
    }

    const mode = workspace.permissionMode;
    const context = {
      globalInstructions: this.deps.globalInstructions(),
      workspaceName: workspace.name,
      workspaceInstructions: instructions,
      project,
      projects: projectList,
      capabilities: mode === 'read_only' ? ('read-only' as const) : ('full' as const),
    };
    let knowledge: Awaited<ReturnType<KnowledgeService['promptSection']>> | undefined;
    try {
      knowledge = await this.deps.knowledge.promptSection(workspace.id);
    } catch (err) {
      this.deps.onError?.('Não foi possível montar o índice de notas', err);
    }
    return {
      cliPath: claude.cli.state === 'found' ? claude.cli.path : '',
      cwd: conversation.cwd,
      resumeSessionId: conversation.claudeSessionId,
      systemPromptAppend: composeSystemPrompt({ ...context, knowledge }),
      // O índice de notas fica fora da chave: muda a cada nota e não precisa reabrir a sessão (o Claude sempre pode
      // procurar na pasta). Instruções, projeto e modo continuam reabrindo.
      promptKey: composeSystemPrompt({ ...context, knowledge: knowledge && { ...knowledge, lines: [], omitted: 0 } }),
      // Ordem: modelo fixo de teste → escolha da conversa → padrão do Workspace → padrão do Claude Code.
      model: this.deps.model ?? conversation.model ?? workspace.defaultModel ?? undefined,
      effort: parseEffort(conversation.effort) ?? workspace.defaultEffort ?? undefined,
      mode,
      additionalDirectories,
      settingSources,
      canUseTool: this.deps.permissions.canUseToolFor({
        workspaceId: workspace.id,
        conversationId: conversation.id,
        mode,
        roots,
      }),
    };
  }

  private async requireClaude(): Promise<ClaudeStatus> {
    const claude = await this.deps.getClaude();
    if (!claude.ready || claude.cli.state !== 'found') {
      throw new NexusError('VALIDATION', 'O Claude Code não está disponível. Veja os detalhes em Configurações.');
    }
    return claude;
  }

  private requireConversation(id: string): ConversationRow {
    const row = this.repo.findConversation(id);
    if (!row) throw new NexusError('NOT_FOUND', 'Conversa não encontrada.');
    return row;
  }

  private toConversation(row: ConversationRow): Conversation {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      projectId: row.projectId,
      title: row.title,
      cwd: row.cwd,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      running: this.deps.sessions.isRunning(row.id),
      model: row.model,
      effort: parseEffort(row.effort) ?? null,
      forkedFrom: row.forkedFrom ?? null,
    };
  }
}

/** Identifica o prompt do sistema enviado numa chamada (para saber se ele mudou desde a última). */
export function hashPrompt(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function continuationTitle(title: string): string {
  const full = `Continuação: ${title}`;
  return full.length > TITLE_MAX ? `${full.slice(0, TITLE_MAX - 1)}…` : full;
}

/**
 * O Claude Code guarda o resumo numa mensagem em inglês que abre e fecha com frases de contexto. Fica só o resumo, na
 * língua em que foi escrito. Sem resumo reconhecível, não se mostra nada (nada é inventado).
 */
export function extractSummary(raw: string | null): string | null {
  if (!raw) return null;
  const paragraphs = raw.trim().split(/\n{2,}/);
  if (/^This session is being continued/i.test(paragraphs[0] ?? '')) paragraphs.shift();
  while (
    paragraphs.length > 0 &&
    /^(Please continue|Continue the conversation|If you need specific details)/i.test(paragraphs.at(-1)!)
  ) {
    paragraphs.pop();
  }
  const text = paragraphs
    .join('\n\n')
    .trim()
    .replace(/^Summary:\s*\n/i, '')
    .trim();
  return text.length > 0 ? text : null;
}

function continuationNotice(
  sourceTitle: string,
  c: { preTokens: number; postTokens: number | null },
  summary: string | null,
): string {
  const size =
    c.postTokens === null
      ? `${c.preTokens.toLocaleString('pt-BR')} tokens de conversa foram resumidos`
      : `${c.preTokens.toLocaleString('pt-BR')} → ${c.postTokens.toLocaleString('pt-BR')} tokens de conversa`;
  const head =
    `**Continuação de «${sourceTitle}».** O Claude Code compactou o histórico (${size}); ` +
    'a conversa original ficou intacta e continua na lista. O histórico de "Desfazer" dos arquivos não foi copiado.';
  return summary ? `${head}\n\n---\n\n${summary}` : head;
}

function parseEffort(value: string | null) {
  const parsed = effortSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Título automático: a primeira linha da primeira mensagem. */
/**
 * Texto que vai ao Claude: o que o usuário escreveu e, em seguida, onde estão os arquivos anexados (ele os abre com a
 * ferramenta Read, que entende imagens e PDFs). Sem texto, o pedido é só olhar os anexos.
 */
export function promptWithAttachments(text: string, files: Array<{ name: string; file: string }>): string {
  if (files.length === 0) return text;
  const list = files.map((f) => `"${f.file}" (${f.name})`).join('; ');
  const intro = text || 'Veja os arquivos anexados.';
  return `${intro}

[Arquivos anexados a esta mensagem. Abra cada um com a ferramenta Read: ${list}]`;
}

export function titleFrom(text: string): string {
  const line = text.trim().split(/\r?\n/)[0]!.replace(/\s+/g, ' ');
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1).trimEnd()}…` : line;
}
