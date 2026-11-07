import type {
  CanUseTool,
  Options,
  SettingSource,
  ModelInfo,
  RewindFilesResult,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { Effort } from '@shared/models';
import type { PermissionMode } from '@shared/permissions';
import { NexusError } from '@shared/ipc-result';
import { AsyncQueue } from './async-queue';
import { childEnv } from './child-env';
import { TurnAccumulator, type TurnEvent, type TurnOutcome } from './turn-accumulator';

/** O que o Nexus usa de um `query()` do Agent SDK (permite trocar por um simulado nos testes). */
export interface AgentQuery extends AsyncIterable<SDKMessage> {
  interrupt(): Promise<unknown>;
  close(): void;
  rewindFiles(userMessageId: string, options?: { dryRun?: boolean }): Promise<RewindFilesResult>;
  supportedModels(): Promise<ModelInfo[]>;
}
export type CreateQuery = (args: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => AgentQuery;

export interface SessionConfig {
  cliPath: string;
  cwd: string;
  /** Sessão do Claude Code a continuar (conversa já existente). */
  resumeSessionId: string | null;
  systemPromptAppend: string;
  /**
   * Identifica o prompt para decidir se a sessão precisa reabrir. Sem ele, vale o texto inteiro. Serve para que
   * mudanças que não precisam valer na hora (o índice de notas) não reiniciem o processo a cada nota.
   */
  promptKey?: string;
  model?: string;
  effort?: Effort;
  /** Pastas extras que o Claude pode acessar (ex.: as notas do Workspace numa conversa de projeto). */
  additionalDirectories?: string[];
  /** Configurações carregadas; sem confiança no projeto, só as do usuário. */
  settingSources?: SettingSource[];
  /** Modo de permissão do Workspace. Mudar reinicia o processo na próxima mensagem. */
  mode: PermissionMode;
  /** Decide os pedidos de permissão (política do Nexus + aprovação do usuário). */
  canUseTool: CanUseTool;
}

export interface TurnHandlers {
  onEvent: (event: TurnEvent) => void;
  onSessionId: (sessionId: string) => void;
  onDone: (outcome: TurnOutcome) => void;
}

/**
 * Modo somente leitura: escrita e execução ficam fora da lista de ferramentas. Restringir com `disallowedTools`
 * (não `tools`) mantém os MCPs sob demanda (achado A da Etapa 0).
 */
export const READ_ONLY_DISALLOWED_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell'];

const DEFAULT_IDLE_MS = 10 * 60_000;
/** Com tarefas em segundo plano rodando, o processo continua aberto (para o Claude avisar quando terminarem), até este limite. */
const BACKGROUND_KEEP_ALIVE_MS = 2 * 60 * 60_000;

interface Turn {
  acc: TurnAccumulator;
  handlers: TurnHandlers;
  finished: boolean;
}

interface LiveSession {
  key: string;
  query: AgentQuery;
  input: AsyncQueue<SDKUserMessage>;
  sessionId: string | null;
  turn: Turn | null;
  idleTimer?: ReturnType<typeof setTimeout>;
  /** Tarefas em segundo plano vivas, como o Claude Code informou (substitui a cada mudança). */
  backgroundTasks: number;
  /** Desde quando o processo está parado esperando tarefas em segundo plano. */
  waitingSince: number | null;
}

export interface SessionManagerDeps {
  createQuery: CreateQuery;
  env: NodeJS.ProcessEnv;
  idleMs?: number;
  /** Quanto tempo esperar por tarefas em segundo plano antes de fechar o processo parado. */
  backgroundKeepAliveMs?: number;
  onStderr?: (conversationId: string, data: string) => void;
}

/**
 * Mantém um processo do Claude Code vivo por conversa ativa, em modo de entrada contínua (Etapa 0, achado C):
 * mensagens seguintes não pagam a partida do processo, `interrupt()` para só o turno atual e cada mensagem leva
 * um uuid próprio (base do "Desfazer"). Processos ociosos são fechados e retomados depois com `resume`.
 */
export class SessionManager {
  private readonly sessions = new Map<string, LiveSession>();
  /** Última sessão do Claude Code de cada conversa, mesmo depois que o processo terminou. */
  private readonly knownSessionIds = new Map<string, string>();
  private spontaneous: ((conversationId: string) => TurnHandlers | null) | null = null;

  constructor(private readonly deps: SessionManagerDeps) {}

  /**
   * Quem trata as respostas que o Claude Code começa sozinho, sem mensagem do usuário (por exemplo, o aviso de que uma
   * tarefa em segundo plano terminou). Devolve os tratadores do turno, ou `null` para ignorar.
   */
  onSpontaneousTurn(handler: (conversationId: string) => TurnHandlers | null): void {
    this.spontaneous = handler;
  }

  isRunning(conversationId: string): boolean {
    return Boolean(this.sessions.get(conversationId)?.turn);
  }

  /** Há um processo do Claude Code aberto para a conversa (parado ou respondendo). */
  hasSession(conversationId: string): boolean {
    return this.sessions.has(conversationId);
  }

  /** Fecha o processo da conversa, se houver. Um turno em andamento é registrado como interrompido. */
  close(conversationId: string, reason = 'Sessão encerrada.'): void {
    this.dispose(conversationId, reason);
  }

  startTurn(
    conversationId: string,
    config: SessionConfig,
    message: { uuid: string; text: string },
    handlers: TurnHandlers,
  ): void {
    let session = this.sessions.get(conversationId);
    if (session?.turn) throw new NexusError('CONFLICT', 'Aguarde a resposta atual terminar.');

    // Instruções, pasta ou modelo mudaram: reabre a sessão (continuando a mesma conversa) com a configuração nova.
    const key = configKey(config);
    if (session && session.key !== key) {
      this.dispose(conversationId, 'Sessão reiniciada.');
      session = undefined;
    }
    session ??= this.open(
      conversationId,
      config,
      key,
      this.knownSessionIds.get(conversationId) ?? config.resumeSessionId,
    );

    clearTimeout(session.idleTimer);
    session.turn = { acc: new TurnAccumulator(handlers.onEvent, message.uuid), handlers, finished: false };
    session.input.push({
      type: 'user',
      uuid: message.uuid as SDKUserMessage['uuid'],
      session_id: '',
      parent_tool_use_id: null,
      message: { role: 'user', content: message.text },
    });
  }

  async interrupt(conversationId: string): Promise<void> {
    const session = this.sessions.get(conversationId);
    if (!session?.turn) return;
    session.turn.acc.markInterrupted();
    try {
      await session.query.interrupt();
    } catch {
      // Se o processo já não responde, encerra a sessão; o turno é registrado como interrompido.
      this.dispose(conversationId, 'Resposta interrompida.');
    }
  }

  /**
   * Desfaz as alterações de arquivos feitas a partir da mensagem `userMessageId` (checkpoint do Claude Code).
   * Funciona mesmo se o processo já foi fechado: a sessão é reaberta com `resume` (Etapa 0, achado I).
   */
  async rewind(
    conversationId: string,
    config: SessionConfig,
    userMessageId: string,
    dryRun = false,
  ): Promise<RewindFilesResult> {
    let session = this.sessions.get(conversationId);
    if (session?.turn) throw new NexusError('CONFLICT', 'Aguarde a resposta atual terminar.');
    const resumeId = this.knownSessionIds.get(conversationId) ?? config.resumeSessionId;
    if (!session) {
      if (!resumeId) throw new NexusError('NOT_FOUND', 'Esta conversa não tem alterações para desfazer.');
      session = this.open(conversationId, config, configKey(config), resumeId);
      this.scheduleIdle(conversationId, session);
    }
    return session.query.rewindFiles(userMessageId, { dryRun });
  }

  /** Encerra tudo (app fechando). Turnos em andamento são registrados como interrompidos. */
  closeAll(): void {
    for (const id of [...this.sessions.keys()]) this.dispose(id, 'O Nexus foi fechado durante a resposta.');
  }

  private open(conversationId: string, config: SessionConfig, key: string, resumeId: string | null): LiveSession {
    const input = new AsyncQueue<SDKUserMessage>();
    const query = this.deps.createQuery({
      prompt: input,
      options: {
        pathToClaudeCodeExecutable: config.cliPath,
        cwd: config.cwd,
        env: childEnv(this.deps.env),
        model: config.model,
        effort: config.effort,
        resume: resumeId ?? undefined,
        includePartialMessages: true,
        settingSources: config.settingSources ?? ['user', 'project', 'local'],
        additionalDirectories: config.additionalDirectories,
        systemPrompt: { type: 'preset', preset: 'claude_code', append: config.systemPromptAppend },
        // Auto: o classificador do Claude Code decide e só pergunta (canUseTool) quando não consegue.
        // Nunca bypassPermissions (ADR 0004).
        permissionMode: config.mode === 'auto' ? 'auto' : 'default',
        disallowedTools: config.mode === 'read_only' ? READ_ONLY_DISALLOWED_TOOLS : undefined,
        canUseTool: config.canUseTool,
        // Base do "Desfazer" (rewindFiles).
        enableFileCheckpointing: true,
        // Instruções alteradas valem na próxima mensagem, mesmo em conversas antigas (Etapa 0, achado D).
        extraArgs: { 'system-prompt-snapshot': 'off' },
        stderr: (data) => this.deps.onStderr?.(conversationId, data),
      },
    });
    const session: LiveSession = {
      key,
      query,
      input,
      sessionId: resumeId,
      turn: null,
      backgroundTasks: 0,
      waitingSince: null,
    };
    this.sessions.set(conversationId, session);
    void this.pump(conversationId, session);
    return session;
  }

  private async pump(conversationId: string, session: LiveSession): Promise<void> {
    try {
      for await (const msg of session.query) {
        if (msg.type === 'system' && msg.subtype === 'background_tasks_changed') {
          session.backgroundTasks = msg.tasks.length;
          // Acabaram as tarefas e ninguém está respondendo: volta a valer o prazo de ociosidade.
          if (!session.turn && this.sessions.get(conversationId) === session) {
            session.waitingSince = null;
            this.scheduleIdle(conversationId, session);
          }
          continue;
        }
        let turn = session.turn;
        if (!turn || turn.finished) {
          // O Claude Code começou uma resposta por conta própria (ex.: a tarefa em segundo plano terminou).
          turn = this.beginSpontaneousTurn(conversationId, session, msg);
          if (!turn) continue;
        }
        turn.acc.push(msg);
        const sessionId = turn.acc.sessionId;
        if (sessionId && sessionId !== session.sessionId) {
          session.sessionId = sessionId;
          this.knownSessionIds.set(conversationId, sessionId);
          turn.handlers.onSessionId(sessionId);
        }
        if (turn.acc.done) this.finishTurn(conversationId, session, turn, turn.acc.done);
      }
      this.end(conversationId, session, 'O Claude Code encerrou a sessão inesperadamente.');
    } catch (err) {
      this.end(conversationId, session, `O Claude Code falhou: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Só conteúdo de verdade abre uma resposta espontânea; avisos soltos e fins de turno vazios são ignorados. */
  private beginSpontaneousTurn(conversationId: string, session: LiveSession, msg: SDKMessage): Turn | null {
    const bearsContent =
      msg.type === 'assistant' ||
      (msg.type === 'stream_event' &&
        (msg.event.type === 'content_block_start' || msg.event.type === 'content_block_delta'));
    if (!bearsContent || !this.spontaneous) return null;
    const handlers = this.spontaneous(conversationId);
    if (!handlers) return null;
    clearTimeout(session.idleTimer);
    session.waitingSince = null;
    const turn: Turn = { acc: new TurnAccumulator(handlers.onEvent), handlers, finished: false };
    session.turn = turn;
    return turn;
  }

  private finishTurn(conversationId: string, session: LiveSession, turn: Turn, outcome: TurnOutcome): void {
    turn.finished = true;
    session.turn = null;
    turn.handlers.onDone(outcome);
    if (this.sessions.get(conversationId) === session) this.scheduleIdle(conversationId, session);
  }

  private scheduleIdle(conversationId: string, session: LiveSession): void {
    clearTimeout(session.idleTimer);
    const idleMs = this.deps.idleMs ?? DEFAULT_IDLE_MS;
    session.idleTimer = setTimeout(() => {
      // Tarefa em segundo plano ainda rodando: fechar o processo a mataria e o Claude nunca poderia avisar.
      if (session.backgroundTasks > 0) {
        session.waitingSince ??= Date.now();
        if (Date.now() - session.waitingSince < (this.deps.backgroundKeepAliveMs ?? BACKGROUND_KEEP_ALIVE_MS)) {
          this.scheduleIdle(conversationId, session);
          return;
        }
      }
      this.dispose(conversationId, 'Sessão ociosa.');
    }, idleMs);
  }

  /** O processo terminou sozinho (fim do fluxo ou erro). */
  private end(conversationId: string, session: LiveSession, reason: string): void {
    const turn = session.turn;
    if (turn && !turn.finished) {
      turn.finished = true;
      session.turn = null;
      turn.handlers.onDone(turn.acc.fail(reason));
    }
    if (this.sessions.get(conversationId) === session) {
      clearTimeout(session.idleTimer);
      this.sessions.delete(conversationId);
    }
  }

  /** Fecha a sessão por iniciativa do Nexus. Um turno em andamento é registrado como interrompido. */
  private dispose(conversationId: string, reason: string): void {
    const session = this.sessions.get(conversationId);
    if (!session) return;
    this.sessions.delete(conversationId);
    clearTimeout(session.idleTimer);
    const turn = session.turn;
    if (turn && !turn.finished) {
      turn.finished = true;
      session.turn = null;
      turn.acc.markInterrupted();
      turn.handlers.onDone(turn.acc.fail(reason));
    }
    session.input.close();
    session.query.close();
  }
}

function configKey(c: SessionConfig): string {
  return JSON.stringify([
    c.cliPath,
    c.cwd,
    c.additionalDirectories ?? [],
    c.settingSources ?? null,
    c.model ?? null,
    c.effort ?? null,
    c.mode,
    c.promptKey ?? c.systemPromptAppend,
  ]);
}
