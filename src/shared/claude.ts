import { z } from 'zod';

/** Versão do Claude Code validada com o Agent SDK no spike da Etapa 0. Versões anteriores geram aviso. */
export const CLAUDE_CLI_TESTED_MIN = '2.1.0';

export const claudeCliSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('found'),
    path: z.string(),
    version: z.string(),
    source: z.enum(['override', 'path', 'native', 'npm']),
  }),
  z.object({ state: z.literal('not_found') }),
  z.object({ state: z.literal('error'), path: z.string(), message: z.string() }),
]);

export const claudeAuthSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('logged_in'),
    method: z.string().nullable(),
    provider: z.string().nullable(),
    email: z.string().nullable(),
    organization: z.string().nullable(),
    plan: z.string().nullable(),
  }),
  z.object({ state: z.literal('logged_out') }),
  z.object({ state: z.literal('unknown'), message: z.string() }),
]);

export const claudeStatusSchema = z.object({
  checkedAt: z.string(),
  cli: claudeCliSchema,
  auth: claudeAuthSchema,
  warnings: z.array(z.string()),
  /** Pronto para conversar: CLI encontrado e conta conectada. */
  ready: z.boolean(),
});

export type ClaudeCli = z.infer<typeof claudeCliSchema>;
export type ClaudeAuth = z.infer<typeof claudeAuthSchema>;
export type ClaudeStatus = z.infer<typeof claudeStatusSchema>;

/** Versão do Claude Code instalada x a mais nova publicada. `available`: há uma versão mais nova para instalar. */
export const claudeUpdateSchema = z.object({
  current: z.string().nullable(),
  latest: z.string().nullable(),
  available: z.boolean(),
});
export type ClaudeUpdate = z.infer<typeof claudeUpdateSchema>;
