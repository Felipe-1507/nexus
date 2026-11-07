import { z } from 'zod';

/** Alteração de um arquivo feita pelo Claude numa resposta: o antes e o depois, para o diff. */
export const fileChangeSchema = z.object({
  path: z.string(),
  /** `create` = o arquivo não existia antes. */
  kind: z.enum(['create', 'edit']),
  before: z.string().nullable(),
  after: z.string().nullable(),
  /** Grande demais para guardar: só o nome aparece, sem diff. */
  truncated: z.boolean(),
});
export type FileChange = z.infer<typeof fileChangeSchema>;

export const codeEntrySchema = z.object({
  name: z.string(),
  /** Caminho relativo à raiz do escopo, com `/`. */
  path: z.string(),
  type: z.enum(['dir', 'file']),
  size: z.number().nullable(),
});
export type CodeEntry = z.infer<typeof codeEntrySchema>;

export const codeFileSchema = z.object({
  path: z.string(),
  /** null quando o arquivo é binário ou grande demais para abrir aqui. */
  content: z.string().nullable(),
  reason: z.enum(['binary', 'too_large']).nullable(),
  size: z.number(),
  mtimeMs: z.number(),
});
export type CodeFile = z.infer<typeof codeFileSchema>;

/** Onde o visualizador de código trabalha: a pasta do projeto, ou a do Workspace (`projectId` null). */
export const codeScopeSchema = z.object({ workspaceId: z.uuid(), projectId: z.uuid().nullable() });
export type CodeScope = z.infer<typeof codeScopeSchema>;

export const CODE_FILE_MAX_BYTES = 2 * 1024 * 1024;
