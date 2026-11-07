import type { DatabaseSync } from 'node:sqlite';
import type { CompactionRecord, ContextSnapshot } from '@shared/context';

interface ContextRow {
  conversation_id: string;
  source: 'live' | 'reconstructed';
  model: string | null;
  context_tokens: number | null;
  input_tokens: number | null;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
  window_tokens: number | null;
  last_call_at: string | null;
  cache_rebuilt: number | null;
  cost_usd: number | null;
  prompt_hash: string | null;
  compaction_trigger: 'manual' | 'auto' | null;
  compaction_pre_tokens: number | null;
  compaction_post_tokens: number | null;
  compaction_duration_ms: number | null;
  compaction_at: string | null;
}

/** O que se grava: a medição sem os campos que só existem na leitura (`windowSource`). */
export type ContextWrite = Omit<ContextSnapshot, 'windowSource'> & { promptHash: string | null };

export interface CompactionWrite {
  id: string;
  conversationId: string;
  sourceConversationId: string | null;
  trigger: 'manual' | 'auto';
  preTokens: number;
  postTokens: number | null;
  durationMs: number | null;
  costUsd: number | null;
  createdAt: string;
}

export class ContextRepo {
  constructor(private readonly db: DatabaseSync) {}

  get(conversationId: string): (ContextSnapshot & { promptHash: string | null }) | null {
    const r = this.db.prepare('SELECT * FROM conversation_context WHERE conversation_id = ?').get(conversationId) as
      ContextRow | undefined;
    if (!r) return null;
    const lastCompaction: CompactionRecord | null =
      r.compaction_trigger && r.compaction_pre_tokens !== null && r.compaction_at
        ? {
            trigger: r.compaction_trigger,
            preTokens: r.compaction_pre_tokens,
            postTokens: r.compaction_post_tokens,
            durationMs: r.compaction_duration_ms,
            at: r.compaction_at,
          }
        : null;
    return {
      conversationId: r.conversation_id,
      source: r.source,
      model: r.model,
      contextTokens: r.context_tokens,
      inputTokens: r.input_tokens,
      cacheReadTokens: r.cache_read_tokens,
      cacheCreationTokens: r.cache_creation_tokens,
      windowTokens: r.window_tokens,
      windowSource: r.window_tokens === null ? null : 'turn',
      lastCallAt: r.last_call_at,
      cacheRebuilt: r.cache_rebuilt === null ? null : r.cache_rebuilt === 1,
      costUsd: r.cost_usd,
      lastCompaction,
      promptHash: r.prompt_hash,
    };
  }

  upsert(s: ContextWrite, updatedAt: string): void {
    this.db
      .prepare(
        `INSERT INTO conversation_context
           (conversation_id, source, model, context_tokens, input_tokens, cache_read_tokens, cache_creation_tokens,
            window_tokens, last_call_at, cache_rebuilt, cost_usd, prompt_hash, compaction_trigger,
            compaction_pre_tokens, compaction_post_tokens, compaction_duration_ms, compaction_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(conversation_id) DO UPDATE SET
           source = excluded.source, model = excluded.model, context_tokens = excluded.context_tokens,
           input_tokens = excluded.input_tokens, cache_read_tokens = excluded.cache_read_tokens,
           cache_creation_tokens = excluded.cache_creation_tokens, window_tokens = excluded.window_tokens,
           last_call_at = excluded.last_call_at, cache_rebuilt = excluded.cache_rebuilt, cost_usd = excluded.cost_usd,
           prompt_hash = excluded.prompt_hash, compaction_trigger = excluded.compaction_trigger,
           compaction_pre_tokens = excluded.compaction_pre_tokens,
           compaction_post_tokens = excluded.compaction_post_tokens,
           compaction_duration_ms = excluded.compaction_duration_ms, compaction_at = excluded.compaction_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        s.conversationId,
        s.source,
        s.model,
        s.contextTokens,
        s.inputTokens,
        s.cacheReadTokens,
        s.cacheCreationTokens,
        s.windowTokens,
        s.lastCallAt,
        s.cacheRebuilt === null ? null : s.cacheRebuilt ? 1 : 0,
        s.costUsd,
        s.promptHash,
        s.lastCompaction?.trigger ?? null,
        s.lastCompaction?.preTokens ?? null,
        s.lastCompaction?.postTokens ?? null,
        s.lastCompaction?.durationMs ?? null,
        s.lastCompaction?.at ?? null,
        updatedAt,
      );
  }

  /** Janela de contexto mais recente informada para um modelo (por qualquer conversa). */
  windowForModel(model: string): number | null {
    const r = this.db
      .prepare(
        `SELECT window_tokens FROM conversation_context
         WHERE model = ? AND window_tokens IS NOT NULL ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(model) as { window_tokens: number } | undefined;
    return r?.window_tokens ?? null;
  }

  insertCompaction(c: CompactionWrite): void {
    this.db
      .prepare(
        `INSERT INTO compactions
           (id, conversation_id, source_conversation_id, trigger, pre_tokens, post_tokens, duration_ms, cost_usd, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        c.id,
        c.conversationId,
        c.sourceConversationId,
        c.trigger,
        c.preTokens,
        c.postTokens,
        c.durationMs,
        c.costUsd,
        c.createdAt,
      );
  }

  listCompactions(conversationId: string): CompactionWrite[] {
    return this.db
      .prepare(
        `SELECT id, conversation_id AS conversationId, source_conversation_id AS sourceConversationId, trigger,
           pre_tokens AS preTokens, post_tokens AS postTokens, duration_ms AS durationMs, cost_usd AS costUsd,
           created_at AS createdAt
         FROM compactions WHERE conversation_id = ? ORDER BY created_at, rowid`,
      )
      .all(conversationId) as unknown as CompactionWrite[];
  }
}
