import { randomUUID } from 'node:crypto';
import os from 'node:os';
import type { DatabaseSync } from 'node:sqlite';
import {
  contextThresholdsSchema,
  DEFAULT_CONTEXT_THRESHOLDS,
  type ContextOverview,
  type ContextSnapshot,
  type ContextThresholds,
} from '@shared/context';
import { NexusError } from '@shared/ipc-result';
import type { TurnCompaction, TurnContext } from '../../agent/turn-accumulator';
import { findTranscript, readTranscriptTail, type TranscriptTail } from '../../agent/transcript-tail';
import { ConversationsRepo, type ConversationRow } from '../../persistence/repositories/conversations-repo';
import { ContextRepo } from '../../persistence/repositories/context-repo';
import { ProjectsRepo } from '../../persistence/repositories/projects-repo';
import { SettingsRepo } from '../../persistence/repositories/settings-repo';

const THRESHOLDS_KEY = 'context.thresholds';
/** O arquivo da sessão é gravado um pouco depois do fim do turno; dentro dessa folga ele não conta como "mexido por fora". */
const TRANSCRIPT_GRACE_MS = 90_000;
/** Prazo para ler o fim de uma transcrição ao abrir a conversa; passado isso vale a última medição guardada. */
const TRANSCRIPT_READ_TIMEOUT_MS = 4_000;
/** Cache recriado = a primeira chamada gravou pelo menos metade do contexto (e o contexto era grande o bastante para importar). */
const REBUILD_MIN_CONTEXT = 20_000;
const REBUILD_RATIO = 0.5;

export interface ContextServiceDeps {
  db: DatabaseSync;
  isRunning: (conversationId: string) => boolean;
  now?: () => string;
  home?: string;
  env?: NodeJS.ProcessEnv;
  /** Localiza e lê o fim da transcrição (trocável nos testes). */
  readTail?: (file: string) => Promise<TranscriptTail | null> | TranscriptTail | null;
  find?: typeof findTranscript;
  newId?: () => string;
}

export interface RecordTurnInput {
  conversationId: string;
  context: TurnContext | null;
  model: string | null;
  compaction: TurnCompaction | null;
  windowTokens: number | null;
  costUsd: number | null;
  /** A conversa já tinha uma sessão do Claude Code antes deste turno (retomada). */
  resumed: boolean;
  promptHash: string | null;
}

/**
 * Medidor de contexto por conversa. Só usa dados que já existem: o uso que o Claude Code informa ao fim de cada turno e,
 * para conversas antigas, o fim do arquivo de transcrição dele. Nunca abre uma sessão nem chama a API para medir.
 */
export class ContextService {
  private readonly repo: ContextRepo;
  private readonly conversations: ConversationsRepo;
  private readonly projects: ProjectsRepo;
  private readonly settings: SettingsRepo;
  private readonly now: () => string;
  private readonly home: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly readTail: (file: string) => Promise<TranscriptTail | null> | TranscriptTail | null;
  /** Leituras de transcrição já feitas (ou em andamento), por arquivo e data de modificação. */
  private readonly tails = new Map<string, { mtimeMs: number; tail: Promise<TranscriptTail | null> }>();
  private readonly find: typeof findTranscript;
  private readonly newId: () => string;

  constructor(private readonly deps: ContextServiceDeps) {
    this.repo = new ContextRepo(deps.db);
    this.conversations = new ConversationsRepo(deps.db);
    this.projects = new ProjectsRepo(deps.db);
    this.settings = new SettingsRepo(deps.db);
    this.now = deps.now ?? (() => new Date().toISOString());
    this.home = deps.home ?? os.homedir();
    this.env = deps.env ?? process.env;
    this.readTail = deps.readTail ?? readTranscriptTail;
    this.find = deps.find ?? findTranscript;
    this.newId = deps.newId ?? randomUUID;
  }

  thresholds(): ContextThresholds {
    return this.settings.get(THRESHOLDS_KEY, contextThresholdsSchema) ?? DEFAULT_CONTEXT_THRESHOLDS;
  }

  setThresholds(next: ContextThresholds): ContextThresholds {
    const parsed = contextThresholdsSchema.safeParse(next);
    if (!parsed.success) throw new NexusError('VALIDATION', parsed.error.issues[0]?.message ?? 'Limites inválidos.');
    this.settings.set(THRESHOLDS_KEY, parsed.data);
    return parsed.data;
  }

  /** Grava a medição de um turno que terminou (dados reais do resultado do Claude Code). */
  recordTurn(input: RecordTurnInput): void {
    const { context, compaction } = input;
    if (!context && !compaction) return;
    const previous = this.repo.get(input.conversationId);
    const at = this.now();
    let measured: Pick<
      ContextSnapshot,
      'contextTokens' | 'inputTokens' | 'cacheReadTokens' | 'cacheCreationTokens' | 'cacheRebuilt' | 'costUsd'
    >;
    if (context) {
      const { last, first } = context;
      const firstContext = first.input + first.cacheRead + first.cacheCreation;
      measured = {
        contextTokens: last.input + last.cacheRead + last.cacheCreation,
        inputTokens: last.input,
        cacheReadTokens: last.cacheRead,
        cacheCreationTokens: last.cacheCreation,
        cacheRebuilt: input.resumed
          ? firstContext >= REBUILD_MIN_CONTEXT && first.cacheCreation >= REBUILD_RATIO * firstContext
          : null,
        costUsd: input.costUsd,
      };
    } else {
      // Compactou sem nenhuma chamada nova: o tamanho atual ainda não foi medido.
      measured = {
        contextTokens: null,
        inputTokens: null,
        cacheReadTokens: null,
        cacheCreationTokens: null,
        cacheRebuilt: null,
        costUsd: input.costUsd,
      };
    }
    const model = input.model ?? previous?.model ?? null;
    this.repo.upsert(
      {
        conversationId: input.conversationId,
        source: 'live',
        model,
        ...measured,
        windowTokens: input.windowTokens ?? previous?.windowTokens ?? null,
        lastCallAt: at,
        lastCompaction: compaction ? { ...compaction, at } : (previous?.lastCompaction ?? null),
        promptHash: input.promptHash,
      },
      at,
    );
  }

  /** Registra a compactação de uma continuação: o contexto novo só será medido na primeira mensagem. */
  recordCompaction(input: {
    conversationId: string;
    sourceConversationId: string | null;
    compaction: TurnCompaction;
    model: string | null;
    windowTokens: number | null;
    costUsd: number | null;
    promptHash: string | null;
  }): void {
    const at = this.now();
    this.repo.insertCompaction({
      id: this.newId(),
      conversationId: input.conversationId,
      sourceConversationId: input.sourceConversationId,
      trigger: input.compaction.trigger,
      preTokens: input.compaction.preTokens,
      postTokens: input.compaction.postTokens,
      durationMs: input.compaction.durationMs,
      costUsd: input.costUsd,
      createdAt: at,
    });
    this.repo.upsert(
      {
        conversationId: input.conversationId,
        source: 'live',
        model: input.model,
        contextTokens: null,
        inputTokens: null,
        cacheReadTokens: null,
        cacheCreationTokens: null,
        windowTokens: input.windowTokens,
        lastCallAt: at,
        cacheRebuilt: null,
        costUsd: input.costUsd,
        lastCompaction: { ...input.compaction, at },
        promptHash: input.promptHash,
      },
      at,
    );
  }

  storedPromptHash(conversationId: string): string | null {
    return this.repo.get(conversationId)?.promptHash ?? null;
  }

  /** Medição já guardada da conversa (instantânea: não toca em arquivos). */
  snapshot(row: ConversationRow): ContextSnapshot | null {
    const stored = this.repo.get(row.id);
    return stored ? this.decorate(stored) : null;
  }

  /**
   * Medição atualizada pela transcrição se alguém usou a sessão fora do Nexus depois da última medição. A leitura do
   * arquivo não trava o app: é assíncrona, reaproveitada enquanto o arquivo não muda e abandonada após um prazo (aí vale
   * a última medição guardada, e a leitura termina em segundo plano para a próxima abertura).
   */
  async snapshotFresh(row: ConversationRow): Promise<ContextSnapshot | null> {
    const stored = this.repo.get(row.id);
    const current = (await this.refreshFromTranscript(row, stored)) ?? this.repo.get(row.id) ?? stored;
    return current ? this.decorate(current) : null;
  }

  async overview(workspaceId: string): Promise<ContextOverview> {
    const projectNames = new Map(this.projects.listByWorkspace(workspaceId).map((p) => [p.id, p.name]));
    // As leituras são assíncronas e independentes: todas andam juntas, sem prender o processo principal.
    const rows: ContextOverview['rows'] = await Promise.all(
      this.conversations.listByWorkspace(workspaceId).map(async (c) => ({
        conversationId: c.id,
        title: c.title,
        projectId: c.projectId,
        projectName: c.projectId ? (projectNames.get(c.projectId) ?? null) : null,
        updatedAt: c.updatedAt,
        running: this.deps.isRunning(c.id),
        forkedFrom: c.forkedFrom ?? null,
        snapshot: await this.snapshotFresh(c),
      })),
    );
    return { rows, thresholds: this.thresholds() };
  }

  /** Fim da transcrição, lido uma vez por versão do arquivo (aberturas seguidas e simultâneas compartilham a leitura). */
  private readTailCached(file: { file: string; mtimeMs: number }): Promise<TranscriptTail | null> {
    const hit = this.tails.get(file.file);
    if (hit && hit.mtimeMs === file.mtimeMs) return hit.tail;
    const tail = Promise.resolve().then(() => this.readTail(file.file));
    this.tails.set(file.file, { mtimeMs: file.mtimeMs, tail });
    // Leitura que falhou não fica guardada: a próxima abertura tenta de novo.
    tail.catch(() => {
      if (this.tails.get(file.file)?.tail === tail) this.tails.delete(file.file);
    });
    return tail;
  }

  private async refreshFromTranscript(
    row: ConversationRow,
    stored: (ContextSnapshot & { promptHash: string | null }) | null,
  ): Promise<(ContextSnapshot & { promptHash: string | null }) | null> {
    if (!row.claudeSessionId || this.deps.isRunning(row.id)) return null;
    const file = this.find(row.claudeSessionId, row.cwd, { home: this.home, env: this.env });
    if (!file) return null;
    const storedAt = stored?.lastCallAt ? Date.parse(stored.lastCallAt) : NaN;
    if (!Number.isNaN(storedAt) && file.mtimeMs <= storedAt + TRANSCRIPT_GRACE_MS) return null;

    let tail: TranscriptTail | null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      tail = await Promise.race([
        this.readTailCached(file),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), TRANSCRIPT_READ_TIMEOUT_MS);
          timer.unref?.();
        }),
      ]);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
    if (!tail) return null;

    const at = this.now();
    if (tail.kind === 'after-compaction') {
      const lastCompaction =
        tail.preTokens !== null
          ? {
              trigger: 'auto' as const,
              preTokens: tail.preTokens,
              postTokens: tail.postTokens,
              durationMs: null,
              at: tail.at ?? new Date(file.mtimeMs).toISOString(),
            }
          : null;
      const next = {
        conversationId: row.id,
        source: 'reconstructed' as const,
        model: stored?.model ?? null,
        contextTokens: null,
        inputTokens: null,
        cacheReadTokens: null,
        cacheCreationTokens: null,
        windowTokens: stored?.windowTokens ?? null,
        lastCallAt: tail.at ?? new Date(file.mtimeMs).toISOString(),
        cacheRebuilt: null,
        costUsd: null,
        lastCompaction,
        promptHash: null,
      };
      this.repo.upsert(next, at);
      return { ...next, windowSource: next.windowTokens === null ? null : 'turn' };
    }

    const u = tail.usage;
    const next = {
      conversationId: row.id,
      source: 'reconstructed' as const,
      model: u.model,
      contextTokens: u.input + u.cacheRead + u.cacheCreation,
      inputTokens: u.input,
      cacheReadTokens: u.cacheRead,
      cacheCreationTokens: u.cacheCreation,
      windowTokens: stored?.model === u.model ? (stored.windowTokens ?? null) : null,
      lastCallAt: u.at,
      cacheRebuilt: null,
      costUsd: null,
      lastCompaction: stored?.lastCompaction ?? null,
      promptHash: null,
    };
    this.repo.upsert(next, at);
    return { ...next, windowSource: next.windowTokens === null ? null : 'turn' };
  }

  /** Sem janela própria, usa a que outra conversa do mesmo modelo informou (dado real, só de outra origem). */
  private decorate(s: ContextSnapshot & { promptHash?: string | null }): ContextSnapshot {
    const { promptHash: _promptHash, ...snapshot } = s;
    if (snapshot.windowTokens === null && snapshot.model) {
      const learned = this.repo.windowForModel(snapshot.model);
      if (learned !== null) return { ...snapshot, windowTokens: learned, windowSource: 'other-conversation' };
    }
    return snapshot;
  }
}
