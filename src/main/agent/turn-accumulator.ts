import path from 'node:path';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Activity, MessageStatus } from '@shared/chat';
import type { FileChange } from '@shared/code';
import { FileChangeTracker } from './file-changes';

export type TurnEvent =
  { type: 'text'; text: string } | { type: 'reset-draft' } | { type: 'activity'; activity: Activity };

/** Uso de uma chamada à API (um passo do turno). O contexto dela é `input + cacheRead + cacheCreation`. */
export interface CallUsage {
  input: number;
  cacheRead: number;
  cacheCreation: number;
  output: number;
}

/** O que o turno revelou sobre o contexto: a primeira e a última chamada à API. */
export interface TurnContext {
  first: CallUsage;
  last: CallUsage;
  calls: number;
}

/** Compactação ocorrida no turno (`/compact` ou a automática do Claude Code). */
export interface TurnCompaction {
  trigger: 'manual' | 'auto';
  preTokens: number;
  postTokens: number | null;
  durationMs: number | null;
}

export interface TurnOutcome {
  status: MessageStatus;
  content: string;
  error: string | null;
  activities: Activity[];
  usage: { inputTokens: number; outputTokens: number } | null;
  /** Modelo que respondeu, como o Claude Code informou no início da sessão. */
  model: string | null;
  /** Arquivos criados ou editados, com o antes e o depois (para o diff). */
  fileChanges: FileChange[];
  /** Medição de contexto do turno; ausente se nenhuma chamada à API aconteceu. */
  context?: TurnContext | null;
  /** Janela de contexto do modelo (`modelUsage[modelo].contextWindow`), quando o resultado a informa. */
  windowTokens?: number | null;
  /** Custo do turno em preço de lista, como o Claude Code calculou. Referência, não a cota do plano. */
  costUsd?: number | null;
  compaction?: TurnCompaction | null;
  /** Resumo que a compactação gerou (a mensagem sintética que o Claude Code insere no lugar do histórico). */
  summaryText?: string | null;
}

const ERROR_MESSAGES: Record<string, string> = {
  authentication_failed: 'A conta do Claude Code precisa entrar de novo. Rode "claude" num terminal.',
  oauth_org_not_allowed: 'A organização desta conta não permite este uso do Claude Code.',
  account_on_hold: 'A conta do Claude está suspensa.',
  verification_required: 'A conta do Claude precisa de verificação.',
  billing_error: 'Problema de cobrança na conta do Claude.',
  rate_limit: 'O limite de uso do seu plano foi atingido. Tente de novo mais tarde.',
  overloaded: 'O Claude está sobrecarregado no momento. Tente de novo em instantes.',
  model_not_found: 'O modelo escolhido não está disponível para esta conta.',
  max_output_tokens: 'A resposta ficou longa demais e foi cortada.',
  server_error: 'Erro no servidor do Claude. Tente de novo.',
};

/**
 * Transforma o fluxo de mensagens do Agent SDK de um turno no que o chat minimalista mostra:
 * - o texto vai chegando como rascunho;
 * - se o Claude decide usar uma ferramenta, o texto escrito até ali era intermediário ("Vou ler o arquivo"):
 *   o rascunho é descartado e vira uma atividade, visível só em "Ver detalhes";
 * - no fim, a resposta é o último texto, e as ferramentas usadas ficam registradas como atividades.
 *
 * As mensagens `assistant` chegam um bloco por vez e sem `stop_reason`, por isso a decisão usa os eventos de
 * streaming (`content_block_start` de `tool_use` e `message_delta`).
 */
export class TurnAccumulator {
  sessionId: string | null = null;
  model: string | null = null;
  private draft = '';
  private readonly activities: Activity[] = [];
  private readonly toolActivity = new Map<string, Activity>();
  private changes = new FileChangeTracker();
  private interrupted = false;
  private apiError: string | null = null;
  private outcome: TurnOutcome | null = null;
  /** Uso por chamada à API, na ordem em que apareceram (a mesma chamada chega em vários quadros com o mesmo id). */
  private readonly calls = new Map<string, CallUsage>();
  private compaction: TurnCompaction | null = null;
  private summaryText: string | null = null;

  /**
   * `userUuid`: uuid da mensagem que o Nexus enviou neste turno. O Claude Code também inicia turnos por conta própria
   * (por exemplo, ao avisar que uma tarefa em segundo plano terminou, o que acontece ao retomar uma conversa feita
   * no VS Code), e cada um deles termina com o seu próprio `result`. Só vale o `result` que traz o nosso uuid.
   * Sem `userUuid`, qualquer `result` vale.
   */
  constructor(
    private readonly emit: (event: TurnEvent) => void,
    private readonly userUuid?: string,
  ) {}

  /** O usuário pediu para parar: o erro de execução que vier em seguida significa "interrompido". */
  markInterrupted(): void {
    this.interrupted = true;
  }

  get done(): TurnOutcome | null {
    return this.outcome;
  }

  push(msg: SDKMessage): void {
    if (msg.type === 'system' && msg.subtype === 'init') {
      this.sessionId = msg.session_id;
      this.model = msg.model ?? null;
      return;
    }
    if (msg.type === 'system' && msg.subtype === 'compact_boundary') {
      const m = msg.compact_metadata;
      this.compaction = {
        trigger: m.trigger,
        preTokens: m.pre_tokens,
        postTokens: m.post_tokens ?? null,
        durationMs: m.duration_ms ?? null,
      };
      return;
    }
    // Frames de subagentes não fazem parte da resposta principal.
    if ('parent_tool_use_id' in msg && msg.parent_tool_use_id) return;

    switch (msg.type) {
      case 'stream_event': {
        const e = msg.event;
        if (e.type === 'content_block_start' && e.content_block.type === 'tool_use') this.flushIntermediate();
        else if (e.type === 'content_block_delta' && e.delta.type === 'text_delta') {
          this.draft += e.delta.text;
          this.emit({ type: 'text', text: e.delta.text });
        } else if (e.type === 'message_delta' && e.delta.stop_reason === 'tool_use') this.flushIntermediate();
        return;
      }
      case 'assistant': {
        if (msg.error) this.apiError = msg.error;
        if (msg.message.model) this.model = msg.message.model;
        const u = msg.message.usage;
        if (u && msg.message.id) {
          this.calls.set(msg.message.id, {
            input: u.input_tokens ?? 0,
            cacheRead: u.cache_read_input_tokens ?? 0,
            cacheCreation: u.cache_creation_input_tokens ?? 0,
            output: u.output_tokens ?? 0,
          });
        }
        for (const block of msg.message.content) {
          if (block.type !== 'tool_use') continue;
          const activity = describeTool(block.name, block.input as Record<string, unknown>);
          this.toolActivity.set(block.id, activity);
          this.addActivity(activity);
        }
        return;
      }
      case 'user': {
        if (msg.tool_use_result) this.changes.record(msg.tool_use_result);
        const content = msg.message.content;
        // Depois de compactar, o Claude Code coloca o resumo no lugar do histórico como uma mensagem sintética.
        if (msg.isSynthetic && this.compaction && this.summaryText === null) {
          const text =
            typeof content === 'string'
              ? content
              : content.map((b) => (b.type === 'text' && 'text' in b ? String(b.text) : '')).join('\n');
          if (text.trim()) this.summaryText = text;
          return;
        }
        if (!Array.isArray(content)) return;
        for (const block of content) {
          if (block.type === 'tool_result' && block.is_error) {
            const activity = this.toolActivity.get(block.tool_use_id);
            if (activity) activity.error = true;
          }
        }
        return;
      }
      case 'result': {
        if (this.isForeignResult(msg)) this.discardForeignTurn();
        else this.finish(msg);
        return;
      }
      default:
        return;
    }
  }

  /**
   * `result` de um turno que não é o nosso: traz o uuid de outra mensagem ou, num turno iniciado pelo próprio Claude
   * Code, nenhum uuid. Um erro sem uuid continua valendo (falhas de partida da sessão não carregam uuid, e o usuário
   * precisa ver o motivo).
   */
  private isForeignResult(msg: Extract<SDKMessage, { type: 'result' }>): boolean {
    if (!this.userUuid) return false;
    const ids = msg.user_message_uuids ?? (msg.user_message_uuid ? [msg.user_message_uuid] : []);
    if (ids.length > 0) return !ids.includes(this.userUuid);
    return msg.subtype === 'success' && !msg.is_error;
  }

  /** Esquece o que o turno alheio produziu: a resposta à nossa mensagem ainda vai chegar. */
  private discardForeignTurn(): void {
    if (this.draft) this.emit({ type: 'reset-draft' });
    this.draft = '';
    this.activities.length = 0;
    this.toolActivity.clear();
    this.changes = new FileChangeTracker();
    this.apiError = null;
    this.calls.clear();
    this.compaction = null;
    this.summaryText = null;
  }

  private turnContext(): TurnContext | null {
    const all = [...this.calls.values()];
    const first = all[0];
    const last = all[all.length - 1];
    return first && last ? { first, last, calls: all.length } : null;
  }

  private windowTokens(msg: Extract<SDKMessage, { type: 'result' }>): number | null {
    const perModel = Object.entries(msg.modelUsage ?? {});
    const entry = perModel.find(([name]) => name === this.model) ?? perModel[0];
    const window = entry?.[1].contextWindow;
    return typeof window === 'number' && window > 0 ? window : null;
  }

  private finish(msg: Extract<SDKMessage, { type: 'result' }>): void {
    const usage = {
      inputTokens:
        msg.usage.input_tokens +
        (msg.usage.cache_read_input_tokens ?? 0) +
        (msg.usage.cache_creation_input_tokens ?? 0),
      outputTokens: msg.usage.output_tokens,
    };
    const base = {
      activities: this.activities,
      usage,
      model: this.model,
      fileChanges: this.changes.list(),
      context: this.turnContext(),
      windowTokens: this.windowTokens(msg),
      costUsd: typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : null,
      compaction: this.compaction,
      summaryText: this.summaryText,
    };
    if (msg.subtype === 'success' && !msg.is_error) {
      this.outcome = {
        ...base,
        status: 'complete',
        content: (msg.result ?? '').trim() || this.draft.trim(),
        error: null,
      };
    } else if (msg.subtype === 'error_during_execution' && this.interrupted) {
      this.outcome = { ...base, status: 'interrupted', content: this.draft.trim(), error: null };
    } else {
      const errors = 'errors' in msg ? msg.errors.filter(Boolean) : [];
      const error =
        (this.apiError && ERROR_MESSAGES[this.apiError]) ||
        errors.join('; ') ||
        (msg.subtype === 'success' ? (msg.result ?? '').trim() : '') ||
        'O Claude Code encerrou a resposta com erro.';
      this.outcome = { ...base, status: 'error', content: this.draft.trim(), error };
    }
  }

  /** Falha fora do fluxo (processo morreu, SDK lançou erro). */
  fail(message: string): TurnOutcome {
    this.outcome ??= {
      status: this.interrupted ? 'interrupted' : 'error',
      content: this.draft.trim(),
      error: this.interrupted ? null : message,
      activities: this.activities,
      usage: null,
      model: this.model,
      fileChanges: this.changes.list(),
    };
    return this.outcome;
  }

  private flushIntermediate(): void {
    const text = this.draft.trim();
    this.draft = '';
    if (!text) return;
    this.emit({ type: 'reset-draft' });
    this.addActivity({ kind: 'intermediate', label: text });
  }

  private addActivity(activity: Activity): void {
    this.activities.push(activity);
    this.emit({ type: 'activity', activity });
  }
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** Frase curta em pt-BR para cada ferramenta, com o detalhe completo à parte. */
export function describeTool(name: string, input: Record<string, unknown>): Activity {
  const file = str(input.file_path) ?? str(input.notebook_path);
  const base = file ? path.basename(file) : undefined;
  switch (name) {
    case 'Read':
      return { kind: 'tool', label: `Leu ${base ?? 'um arquivo'}`, detail: file };
    case 'Write':
      return { kind: 'tool', label: `Criou ${base ?? 'um arquivo'}`, detail: file, changedFile: file };
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return { kind: 'tool', label: `Editou ${base ?? 'um arquivo'}`, detail: file, changedFile: file };
    case 'Glob':
      return { kind: 'tool', label: 'Procurou arquivos', detail: str(input.pattern) };
    case 'Grep':
      return { kind: 'tool', label: `Buscou "${str(input.pattern) ?? ''}"`, detail: str(input.path) };
    case 'Bash':
    case 'PowerShell':
      return { kind: 'tool', label: 'Executou um comando', detail: str(input.command) };
    case 'WebSearch':
      return { kind: 'tool', label: `Pesquisou "${str(input.query) ?? ''}" na web` };
    case 'WebFetch':
      return { kind: 'tool', label: 'Abriu uma página da web', detail: str(input.url) };
    case 'TodoWrite':
      return { kind: 'tool', label: 'Organizou as tarefas' };
    case 'Task':
    case 'Agent':
      return { kind: 'tool', label: 'Delegou uma subtarefa', detail: str(input.description) };
    default: {
      const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
      return mcp ? { kind: 'tool', label: `Usou ${mcp[2]} (${mcp[1]})` } : { kind: 'tool', label: `Usou ${name}` };
    }
  }
}
