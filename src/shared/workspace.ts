import { z } from 'zod';
import { effortSchema } from './models';
import { permissionModeSchema } from './permissions';

/** Paletas e ícones permitidos. O renderer mapeia cada id para a cor e o ícone reais. */
export const WORKSPACE_COLORS = ['violet', 'blue', 'teal', 'green', 'amber', 'orange', 'rose', 'slate'] as const;
export const WORKSPACE_ICONS = [
  'layers',
  'briefcase',
  'wallet',
  'code',
  'home',
  'book',
  'flask',
  'rocket',
  'heart',
  'graduation',
] as const;

export const workspaceColorSchema = z.enum(WORKSPACE_COLORS);
export const workspaceIconSchema = z.enum(WORKSPACE_ICONS);
export type WorkspaceColor = z.infer<typeof workspaceColorSchema>;
export type WorkspaceIcon = z.infer<typeof workspaceIconSchema>;

export const WORKSPACE_NAME_MAX = 60;
export const workspaceNameSchema = z
  .string()
  .trim()
  .min(1, 'Dê um nome ao Workspace')
  .max(WORKSPACE_NAME_MAX, `Use no máximo ${WORKSPACE_NAME_MAX} caracteres`)
  // eslint-disable-next-line no-control-regex
  .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), 'O nome tem caracteres inválidos');

export const workspaceSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  color: workspaceColorSchema,
  icon: workspaceIconSchema,
  rootPath: z.string(),
  /** Pasta das notas (segundo cérebro) deste Workspace. */
  knowledgeDir: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** `missing` quando a pasta do Workspace não existe mais no disco. */
  folderStatus: z.enum(['ok', 'missing']),
  permissionMode: permissionModeSchema,
  /** Modelo e esforço padrão das conversas deste Workspace; `null` = padrão do Claude Code. */
  defaultModel: z.string().nullable(),
  defaultEffort: effortSchema.nullable(),
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const createWorkspaceSchema = z.object({
  name: workspaceNameSchema,
  color: workspaceColorSchema,
  icon: workspaceIconSchema,
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

export const updateWorkspaceSchema = z.object({
  id: z.uuid(),
  name: workspaceNameSchema.optional(),
  color: workspaceColorSchema.optional(),
  icon: workspaceIconSchema.optional(),
});
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;

/** Limite do workspace.md: instruções vão para o contexto do Claude em toda mensagem. */
export const INSTRUCTIONS_MAX_BYTES = 64 * 1024;

export const instructionsSchema = z.object({ content: z.string(), mtimeMs: z.number() });
export type Instructions = z.infer<typeof instructionsSchema>;

export const saveInstructionsSchema = z.object({
  id: z.uuid(),
  content: z.string(),
  /** mtime lido ao abrir o editor. Se o arquivo mudou desde então, a gravação é recusada (CONFLICT). */
  expectedMtimeMs: z.number(),
});
