import { z } from 'zod';

/**
 * Painel de MCP e plugins do Claude Code (Configurações → Extensões do Claude). Mostra o que está configurado, sem
 * ler segredos (variáveis de ambiente e cabeçalhos nunca saem do arquivo), e, sob demanda, se cada servidor conecta e
 * quanto do contexto inicial ele ocupa.
 */

export const extensionScopeSchema = z.enum(['user', 'project', 'local', 'plugin']);
export type ExtensionScope = z.infer<typeof extensionScopeSchema>;

export const declaredServerSchema = z.object({
  name: z.string(),
  scope: extensionScopeSchema,
  /** Projeto do Nexus (escopos `project` e `local`) ou id do plugin; vazio no escopo `user`. */
  origin: z.string(),
  transport: z.enum(['stdio', 'http', 'sse', 'outro']),
  /** Programa (só o nome do executável) ou endereço sem parâmetros: nada que possa carregar um segredo. */
  target: z.string(),
});
export type DeclaredServer = z.infer<typeof declaredServerSchema>;

export const declaredPluginSchema = z.object({
  id: z.string(),
  version: z.string().nullable(),
  enabled: z.boolean(),
  /** Servidores MCP que o plugin traz (nomes). */
  servers: z.array(z.string()),
});
export type DeclaredPlugin = z.infer<typeof declaredPluginSchema>;

export const extensionsListSchema = z.object({
  servers: z.array(declaredServerSchema),
  plugins: z.array(declaredPluginSchema),
  /** Arquivos que não puderam ser lidos (JSON inválido etc.), para a tela avisar em vez de mostrar uma lista incompleta calada. */
  problems: z.array(z.string()),
});
export type ExtensionsList = z.infer<typeof extensionsListSchema>;

export const serverStatusSchema = z.object({
  name: z.string(),
  status: z.enum(['connected', 'failed', 'needs-auth', 'pending', 'disabled']),
  /** Onde a definição está (user, project, plugin, claudeai…), como o Claude Code informa. */
  source: z.string().nullable(),
  error: z.string().nullable(),
  tools: z.number().int(),
  /** Tokens que as ferramentas deste servidor ocupam no contexto inicial (0 se carregadas só sob demanda). */
  tokens: z.number().int(),
});
export type ServerStatus = z.infer<typeof serverStatusSchema>;

export const extensionsProbeSchema = z.object({
  checkedAt: z.string(),
  /** De onde a leitura veio: conversa geral (configurações do usuário) ou um projeto. */
  scope: z.string(),
  servers: z.array(serverStatusSchema),
  /** Soma das ferramentas MCP carregadas no contexto inicial. */
  mcpTokens: z.number().int(),
  /** Contexto inicial inteiro (prompt, ferramentas, memória…) e o tamanho da janela, para dar a proporção. */
  baseTokens: z.number().int(),
  maxTokens: z.number().int(),
});
export type ExtensionsProbe = z.infer<typeof extensionsProbeSchema>;

/** A partir deste peso (tokens no contexto inicial), a tela destaca o servidor como pesado. */
export const HEAVY_SERVER_TOKENS = 5_000;
