import type {
  McpServerStatus,
  Options,
  SDKControlGetContextUsageResponse,
  SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { ExtensionsProbe, ServerStatus } from '@shared/extensions';
import { AsyncQueue } from './async-queue';
import { childEnv } from './child-env';

/** O que a sondagem usa do SDK: abrir uma consulta sem mensagem e perguntar pelos servidores MCP e pelo contexto. */
export interface ProbeQuery extends AsyncIterable<SDKMessage> {
  mcpServerStatus(): Promise<McpServerStatus[]>;
  getContextUsage(opts?: { detail?: 'summary' | 'full' }): Promise<SDKControlGetContextUsageResponse>;
  close(): void;
}
export type CreateProbeQuery = (args: { prompt: AsyncIterable<never>; options: Options }) => ProbeQuery;

const TIMEOUT_MS = 90_000;

/** Normaliza o nome como o Claude Code o faz em `mcpTools[].serverName` (letras, números, `_` e `-`). */
const normalize = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, '_');

/** Junta o estado dos servidores com o peso das ferramentas de cada um no contexto inicial. */
export function toProbe(
  scope: string,
  statuses: McpServerStatus[],
  usage: SDKControlGetContextUsageResponse,
  now: Date,
): ExtensionsProbe {
  const tokensByServer = new Map<string, number>();
  for (const tool of usage.mcpTools) {
    if (tool.isLoaded === false) continue;
    tokensByServer.set(tool.serverName, (tokensByServer.get(tool.serverName) ?? 0) + tool.tokens);
  }
  const servers: ServerStatus[] = statuses.map((s) => ({
    name: s.name,
    status: s.status,
    source: s.source ?? s.scope ?? null,
    error: s.error ?? null,
    tools: s.tools?.length ?? 0,
    tokens: tokensByServer.get(s.name) ?? tokensByServer.get(normalize(s.name)) ?? 0,
  }));
  const mcpTokens =
    usage.categories.find((c) => c.id === 'mcp_tools')?.tokens ??
    [...tokensByServer.values()].reduce((a, b) => a + b, 0);
  const used = usage.categories.filter((c) => c.kind === 'used').reduce((a, c) => a + c.tokens, 0);
  return {
    checkedAt: now.toISOString(),
    scope,
    servers: servers.sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name, 'pt-BR')),
    mcpTokens,
    baseTokens: used,
    maxTokens: usage.maxTokens,
  };
}

/**
 * Abre o Claude Code sem mandar mensagem, pergunta quais servidores MCP conectaram e quanto cada um pesa no contexto
 * inicial, e fecha. Não gasta tokens de conversa (a contagem usa a API de contagem, que não gera resposta). Iniciar
 * a consulta sobe os servidores MCP configurados, então pode levar alguns segundos.
 */
export async function probeExtensions(args: {
  createQuery: CreateProbeQuery;
  env: NodeJS.ProcessEnv;
  cliPath: string;
  cwd: string;
  /** Configurações carregadas: só as do usuário, ou as do projeto também quando ele é confiável. */
  settingSources: Options['settingSources'];
  scope: string;
  now?: () => Date;
}): Promise<ExtensionsProbe> {
  const input = new AsyncQueue<never>();
  const query = args.createQuery({
    prompt: input,
    options: {
      pathToClaudeCodeExecutable: args.cliPath,
      env: childEnv(args.env),
      cwd: args.cwd,
      settingSources: args.settingSources,
      persistSession: false,
    },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const [statuses, usage] = await Promise.race([
      (async () => [await query.mcpServerStatus(), await query.getContextUsage({ detail: 'full' })] as const)(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('O Claude Code não respondeu a tempo.')), TIMEOUT_MS);
      }),
    ]);
    return toProbe(args.scope, statuses, usage, (args.now ?? (() => new Date()))());
  } finally {
    clearTimeout(timer);
    input.close();
    query.close();
  }
}
