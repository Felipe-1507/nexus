import { z } from 'zod';

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export const effortSchema = z.enum(EFFORT_LEVELS);
export type Effort = z.infer<typeof effortSchema>;

/**
 * Identificador de modelo como o Claude Code aceita: atalho (`opus`, `haiku`) ou nome completo
 * (`claude-sonnet-4-6`). Vai como argumento do processo (sem shell), mas mesmo assim só aceita esse formato.
 */
export const modelIdSchema = z.string().regex(/^[a-z0-9][a-z0-9.\-[\]]{0,79}$/i, 'Modelo inválido');

/** Modelo e esforço de um Workspace novo (escolha do usuário: Sonnet · Médio). */
export const DEFAULT_MODEL = 'sonnet';
export const DEFAULT_EFFORT: Effort = 'medium';

/** Escolha de modelo e esforço. `null` = herdar (conversa → Workspace → padrão do Claude Code). */
export const modelChoiceSchema = z.object({
  model: modelIdSchema.nullable(),
  effort: effortSchema.nullable(),
});
export type ModelChoice = z.infer<typeof modelChoiceSchema>;

export const modelOptionSchema = z.object({
  value: z.string(),
  displayName: z.string(),
  description: z.string(),
  /** Modelo concreto por trás de um atalho (ex.: opus → claude-opus-5-5). */
  resolvedModel: z.string().nullable(),
  efforts: z.array(effortSchema),
  /** Atalho que acompanha a versão mais nova, ou versão fixa. */
  kind: z.enum(['alias', 'version']),
});
export type ModelOption = z.infer<typeof modelOptionSchema>;

export const modelCatalogSchema = z.object({
  /** O que "Padrão" significa hoje para esta conta (ex.: Opus 5.5). */
  defaultModel: modelOptionSchema.nullable(),
  models: z.array(modelOptionSchema),
});
export type ModelCatalog = z.infer<typeof modelCatalogSchema>;

export const EFFORT_LABELS: Record<Effort, string> = {
  low: 'Baixo',
  medium: 'Médio',
  high: 'Alto',
  xhigh: 'Muito alto',
  max: 'Máximo',
};
