import { z } from 'zod';
import { conversationSchema } from './chat';

/**
 * Contexto de uma conversa: o que o Claude Code enviou na última chamada à API. É o tamanho da conversa que vai (quase
 * toda) do cache a cada passo, não o consumo da cota do plano (esse vem de `usage:get`).
 */
export const contextSourceSchema = z.enum([
  /** Medido no fim de um turno feito no Nexus. */
  'live',
  /** Lido do arquivo de transcrição do Claude Code (conversa antiga ou usada fora do Nexus). */
  'reconstructed',
]);
export type ContextSource = z.infer<typeof contextSourceSchema>;

export const compactionRecordSchema = z.object({
  trigger: z.enum(['manual', 'auto']),
  preTokens: z.number().int(),
  postTokens: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  at: z.string(),
});
export type CompactionRecord = z.infer<typeof compactionRecordSchema>;

export const contextSnapshotSchema = z.object({
  conversationId: z.string(),
  source: contextSourceSchema,
  model: z.string().nullable(),
  /** Entrada nova + cache lido + cache gravado da última chamada. `null` logo após uma compactação (ainda não medido). */
  contextTokens: z.number().int().nullable(),
  /** Tokens novos (sem cache) da última chamada. */
  inputTokens: z.number().int().nullable(),
  cacheReadTokens: z.number().int().nullable(),
  cacheCreationTokens: z.number().int().nullable(),
  /** Janela do modelo, como o Claude Code informou. `null` = desconhecida. */
  windowTokens: z.number().int().nullable(),
  /** De onde veio a janela: do próprio turno, ou de outra conversa com o mesmo modelo. */
  windowSource: z.enum(['turn', 'other-conversation']).nullable(),
  /** Fim da última chamada conhecida. */
  lastCallAt: z.string().nullable(),
  /** A primeira chamada do último turno gravou quase todo o contexto no cache (o cache tinha expirado ou foi invalidado). */
  cacheRebuilt: z.boolean().nullable(),
  /** Custo do último turno em preço de lista (referência; não é a cota do plano). */
  costUsd: z.number().nullable(),
  lastCompaction: compactionRecordSchema.nullable(),
});
export type ContextSnapshot = z.infer<typeof contextSnapshotSchema>;

export const contextThresholdsSchema = z
  .object({
    attention: z.number().int().min(1).max(98),
    high: z.number().int().min(2).max(99),
    critical: z.number().int().min(3).max(100),
  })
  .refine((t) => t.attention < t.high && t.high < t.critical, {
    message: 'Os limites precisam estar em ordem crescente (atenção < elevado < crítico).',
  });
export type ContextThresholds = z.infer<typeof contextThresholdsSchema>;

export const DEFAULT_CONTEXT_THRESHOLDS: ContextThresholds = { attention: 50, high: 75, critical: 90 };

export type ContextLevel = 'normal' | 'attention' | 'high' | 'critical';

export const CONTEXT_LEVEL_LABELS: Record<ContextLevel, string> = {
  normal: 'Normal',
  attention: 'Atenção',
  high: 'Contexto elevado',
  critical: 'Quase cheio',
};

/** Percentual de ocupação, ou `null` quando falta o tamanho do contexto ou a janela do modelo (nada é presumido). */
export function contextPercent(snapshot: Pick<ContextSnapshot, 'contextTokens' | 'windowTokens'>): number | null {
  const { contextTokens, windowTokens } = snapshot;
  if (contextTokens === null || windowTokens === null || windowTokens <= 0) return null;
  return (contextTokens / windowTokens) * 100;
}

export function contextLevel(percent: number | null, t: ContextThresholds): ContextLevel | null {
  if (percent === null) return null;
  if (percent >= t.critical) return 'critical';
  if (percent >= t.high) return 'high';
  if (percent >= t.attention) return 'attention';
  return 'normal';
}

/**
 * O cache de prompt do Claude Code usa a camada de 1 hora (observada nos registros: `ephemeral_1h`). A API não informa
 * quando ele expira, então depois de 1 h parado só se pode dizer que ele "pode ter expirado".
 */
export const CACHE_TTL_MS = 60 * 60_000;
/** Abaixo disso, recriar o cache é barato demais para merecer aviso. */
export const CACHE_WARN_MIN_TOKENS = 50_000;

export type CacheStatus =
  /** Houve atividade há menos de 1 h: o cache provavelmente está valendo. */
  | { state: 'active'; idleMs: number }
  /** Parada há mais de 1 h: o cache pode ter expirado, e a próxima mensagem pode recriá-lo. */
  | { state: 'maybe-expired'; idleMs: number }
  | { state: 'unknown'; idleMs: null };

export function cacheStatus(snapshot: Pick<ContextSnapshot, 'lastCallAt'> | null, now: number): CacheStatus {
  const at = snapshot?.lastCallAt ? Date.parse(snapshot.lastCallAt) : NaN;
  if (Number.isNaN(at)) return { state: 'unknown', idleMs: null };
  const idleMs = Math.max(0, now - at);
  return { state: idleMs >= CACHE_TTL_MS ? 'maybe-expired' : 'active', idleMs };
}

/** Conversa grande e parada o bastante para a próxima mensagem poder recriar o cache inteiro. */
export function shouldWarnCache(snapshot: ContextSnapshot | null, now: number): boolean {
  if (!snapshot || snapshot.contextTokens === null) return false;
  return snapshot.contextTokens >= CACHE_WARN_MIN_TOKENS && cacheStatus(snapshot, now).state === 'maybe-expired';
}

export function formatTokens(n: number | null): string {
  if (n === null) return 'indisponível';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2).replace('.', ',')} mi`;
  if (n >= 10_000) return `${Math.round(n / 1000)} mil`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.', ',')} mil`;
  return String(n);
}

export function formatIdle(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'agora há pouco';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} d`;
}

export const contextStateSchema = z.object({
  snapshot: contextSnapshotSchema.nullable(),
  thresholds: contextThresholdsSchema,
  /**
   * O prompt do sistema montado agora é diferente do usado na última chamada (por exemplo, o índice de notas mudou):
   * reabrir a sessão não aproveita o cache. `null` = não foi possível comparar (ou há um processo aberto, que mantém o prompt).
   */
  promptChanged: z.boolean().nullable(),
});
export type ContextState = z.infer<typeof contextStateSchema>;

export const contextOverviewRowSchema = z.object({
  conversationId: z.string(),
  title: z.string(),
  projectId: z.string().nullable(),
  /** `null` = conversa geral do Workspace. */
  projectName: z.string().nullable(),
  updatedAt: z.string(),
  running: z.boolean(),
  forkedFrom: z.string().nullable(),
  snapshot: contextSnapshotSchema.nullable(),
});
export type ContextOverviewRow = z.infer<typeof contextOverviewRowSchema>;

export const contextOverviewSchema = z.object({
  rows: z.array(contextOverviewRowSchema),
  thresholds: contextThresholdsSchema,
});
export type ContextOverview = z.infer<typeof contextOverviewSchema>;

export const continuationPreviewSchema = z.object({
  conversationId: z.string(),
  title: z.string(),
  snapshot: contextSnapshotSchema.nullable(),
  /** Já existe uma continuação desta conversa feita depois da última atividade dela. */
  existing: conversationSchema.nullable(),
  running: z.boolean(),
});
export type ContinuationPreview = z.infer<typeof continuationPreviewSchema>;

export const continueInputSchema = z.object({
  conversationId: z.uuid(),
  /** Pede à compactação um resumo organizado em seções (e o mostra na conversa nova). */
  structuredSummary: z.boolean(),
});

export const continueResultSchema = z.object({
  conversation: conversationSchema,
  compaction: z.object({
    preTokens: z.number().int(),
    postTokens: z.number().int().nullable(),
    durationMs: z.number().int().nullable(),
    costUsd: z.number().nullable(),
  }),
  summaryShown: z.boolean(),
  /** Era uma continuação que já existia (nada foi criado de novo). */
  alreadyExisted: z.boolean(),
});
export type ContinueResult = z.infer<typeof continueResultSchema>;

/** Instruções entregues à compactação nativa (`/compact <instruções>`) quando o resumo estruturado está ligado. */
export const STRUCTURED_SUMMARY_INSTRUCTIONS =
  'Escreva o resumo em português do Brasil, organizado exatamente nestas seções: ' +
  '1. Objetivo do projeto; 2. Funcionalidades existentes e alterações realizadas; ' +
  '3. Arquivos importantes envolvidos (com caminhos completos); 4. Decisões técnicas; ' +
  '5. Problemas conhecidos; 6. Próximos passos. Preserve nomes de arquivos, comandos e valores exatos.';
