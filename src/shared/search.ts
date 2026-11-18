import { z } from 'zod';

/** Busca nas conversas: quantos trechos voltam no máximo, e quantos por conversa (para uma só não tomar a lista). */
export const SEARCH_MAX_HITS = 100;
export const SEARCH_MAX_PER_CONVERSATION = 6;
export const SEARCH_MIN_LENGTH = 2;

export const searchInputSchema = z.object({
  workspaceId: z.uuid(),
  /** Palavras separadas por espaço (todas precisam aparecer); "entre aspas" vale como uma só. */
  query: z.string().trim().min(SEARCH_MIN_LENGTH).max(200),
  /** Um projeto = só as conversas dele. Ausente = todas as conversas do Workspace (gerais e de projetos). */
  projectId: z.uuid().optional(),
});
export type SearchInput = z.infer<typeof searchInputSchema>;

export const searchHitSchema = z.object({
  conversationId: z.string(),
  conversationTitle: z.string(),
  /** Projeto da conversa; `null` = conversa geral do Workspace. */
  projectId: z.string().nullable(),
  /** `null` = a conversa foi achada pelo título. */
  messageId: z.string().nullable(),
  role: z.enum(['user', 'assistant']).nullable(),
  createdAt: z.string(),
  /** Trecho do texto original, com reticências nas pontas cortadas. */
  text: z.string(),
  /** Onde, dentro de `text`, estão as palavras achadas: pares [início, fim). */
  ranges: z.array(z.tuple([z.number().int(), z.number().int()])),
});
export type SearchHit = z.infer<typeof searchHitSchema>;

export const searchResultSchema = z.object({
  hits: z.array(searchHitSchema),
  /** Havia mais resultados do que os limites mostram. */
  truncated: z.boolean(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;
