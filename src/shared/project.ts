import { z } from 'zod';

export const PROJECT_NAME_MAX = 80;
export const PROJECT_INSTRUCTIONS_MAX = 32 * 1024;

export const projectNameSchema = z
  .string()
  .trim()
  .min(1, 'Dê um nome ao projeto')
  .max(PROJECT_NAME_MAX, `Use no máximo ${PROJECT_NAME_MAX} caracteres`);

/** Situação da pasta: `unavailable` = não respondeu a tempo (ex.: servidor de rede fora do ar). */
export const pathStatusSchema = z.enum(['ok', 'missing', 'unavailable']);
export type PathStatus = z.infer<typeof pathStatusSchema>;

/**
 * Confiança nas configurações do próprio projeto (hooks, MCP, regras de permissão):
 * - `none`: o projeto não tem nada que execute código;
 * - `trusted`: o usuário aceitou exatamente as configurações atuais;
 * - `untrusted`: há configurações e o usuário não as aceitou (não são carregadas);
 * - `changed`: foram aceitas, mas mudaram desde então (não são carregadas até nova confirmação).
 */
export const configTrustSchema = z.enum(['none', 'trusted', 'untrusted', 'changed']);
export type ConfigTrust = z.infer<typeof configTrustSchema>;

export const projectSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  kind: z.enum(['linked', 'managed']),
  path: z.string(),
  instructions: z.string(),
  status: pathStatusSchema,
  configTrust: configTrustSchema,
  /** O que as configurações do projeto fazem, em pt-BR (para o pedido de confiança). */
  configRisks: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof projectSchema>;

export const folderInspectionSchema = z.object({
  path: z.string(),
  status: pathStatusSchema,
  isDirectory: z.boolean(),
  suggestedName: z.string(),
  configRisks: z.array(z.string()),
  /** Já vinculada a este Workspace. */
  alreadyLinked: z.boolean(),
});
export type FolderInspection = z.infer<typeof folderInspectionSchema>;

export const createProjectSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('linked'),
    workspaceId: z.uuid(),
    name: projectNameSchema,
    path: z.string().min(3, 'Informe o caminho da pasta'),
    /** O usuário aceitou as configurações do projeto que executam código. */
    trustConfig: z.boolean(),
  }),
  z.object({ kind: z.literal('managed'), workspaceId: z.uuid(), name: projectNameSchema }),
]);
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

/** Conversa do Claude Code existente na pasta do projeto, que pode ser importada. */
export const claudeSessionSummarySchema = z.object({
  sessionId: z.string(),
  summary: z.string(),
  lastModified: z.number(),
  /** Já importada para uma conversa do Nexus. */
  imported: z.boolean(),
});
export type ClaudeSessionSummary = z.infer<typeof claudeSessionSummarySchema>;

export const GLOBAL_INSTRUCTIONS_MAX = 32 * 1024;
