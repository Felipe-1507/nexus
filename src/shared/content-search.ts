import { z } from 'zod';
import { SEARCH_MIN_LENGTH } from './search';

/** Busca no conteúdo das notas e nos arquivos dos projetos (a das conversas está em `search.ts`). */
export const CONTENT_MAX_HITS = 60;

export const contentSearchInputSchema = z.object({
  workspaceId: z.uuid(),
  query: z.string().trim().min(SEARCH_MIN_LENGTH).max(200),
  kind: z.enum(['notes', 'files']),
  /** Só para `files`: um projeto. Ausente = todos os projetos do Workspace. */
  projectId: z.uuid().optional(),
});
export type ContentSearchInput = z.infer<typeof contentSearchInputSchema>;

export const contentHitSchema = z.object({
  kind: z.enum(['note', 'file']),
  /** Nota: caminho no vault. Arquivo: caminho relativo à pasta do projeto. Sempre com `/`. */
  path: z.string(),
  /** Nome para mostrar (título da nota ou nome do arquivo). */
  name: z.string(),
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  /** Linha (1 = primeira) do trecho no arquivo; `null` quando a palavra está só no nome. */
  line: z.number().int().nullable(),
  /** Trecho do texto original; vazio quando só o nome combinou. */
  text: z.string(),
  ranges: z.array(z.tuple([z.number().int(), z.number().int()])),
});
export type ContentHit = z.infer<typeof contentHitSchema>;

export const contentSearchResultSchema = z.object({
  hits: z.array(contentHitSchema),
  /** Havia mais resultados do que o limite mostra. */
  truncated: z.boolean(),
  /** A varredura parou por tempo ou por quantidade de arquivos: pode haver resultados que não vieram. */
  incomplete: z.boolean(),
  /** Quantos arquivos/notas foram examinados. */
  scanned: z.number().int(),
});
export type ContentSearchResult = z.infer<typeof contentSearchResultSchema>;
