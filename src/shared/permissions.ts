import { z } from 'zod';

/**
 * Modo de permissão de um Workspace (ADR 0004):
 * - `auto`: o classificador do Claude Code libera o que é rotina e bloqueia ou pergunta o que é arriscado;
 * - `ask`: editar arquivos e executar comandos pede aprovação;
 * - `read_only`: só leitura.
 */
export const permissionModeSchema = z.enum(['auto', 'ask', 'read_only']);
export type PermissionMode = z.infer<typeof permissionModeSchema>;

export const permissionDecisionSchema = z.enum(['allow_once', 'allow_always', 'deny']);
export type PermissionDecision = z.infer<typeof permissionDecisionSchema>;

/** Pergunta com opções feita pelo Claude (ferramenta AskUserQuestion). */
export const claudeQuestionSchema = z.object({
  question: z.string(),
  header: z.string(),
  multiSelect: z.boolean(),
  options: z.array(z.object({ label: z.string(), description: z.string() })),
});
export type ClaudeQuestion = z.infer<typeof claudeQuestionSchema>;

/** Respostas às perguntas: texto da pergunta -> opção escolhida (várias, separadas por vírgula; ou texto livre). */
export const questionAnswersSchema = z.record(z.string().max(2000), z.string().max(2000));
export type QuestionAnswers = z.infer<typeof questionAnswersSchema>;

/** Pedido de aprovação esperando o usuário. */
export const permissionRequestSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  workspaceId: z.string(),
  tool: z.string(),
  /** O que o Claude quer fazer, em pt-BR ("Executar um comando"). */
  title: z.string(),
  /** Comando, caminho ou endereço completo. */
  detail: z.string().optional(),
  /** Texto do botão "Sempre permitir…", quando a ação admite uma regra. */
  alwaysLabel: z.string().optional(),
  /** Presente quando o Claude está perguntando em vez de pedir permissão. */
  questions: z.array(claudeQuestionSchema).optional(),
  createdAt: z.string(),
});
export type PermissionRequest = z.infer<typeof permissionRequestSchema>;

export const permissionRuleSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  tool: z.string(),
  pattern: z.string(),
  /** Descrição para a tela ("Comandos que começam com npm test"). */
  label: z.string(),
  createdAt: z.string(),
});
export type PermissionRule = z.infer<typeof permissionRuleSchema>;

export const auditEntrySchema = z.object({
  id: z.number(),
  conversationId: z.string().nullable(),
  tool: z.string(),
  summary: z.string(),
  detail: z.string().nullable(),
  decision: z.enum(['allow', 'deny']),
  decidedBy: z.enum(['policy', 'rule', 'user', 'timeout', 'cancel']),
  createdAt: z.string(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;
