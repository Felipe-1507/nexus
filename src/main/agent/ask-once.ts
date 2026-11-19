import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { childEnv } from './child-env';

/** O que `askClaudeOnce` usa de um `query()` do Agent SDK (permite trocar por um simulado nos testes). */
export type CreateOneShot = (args: { prompt: string; options: Options }) => AsyncIterable<SDKMessage> & {
  close(): void;
};

export interface AskOnceArgs {
  createQuery: CreateOneShot;
  env: NodeJS.ProcessEnv;
  cliPath: string;
  cwd: string;
  system: string;
  prompt: string;
  /** Modelo pequeno por padrão: a tarefa é reescrever poucos fatos. */
  model?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 90_000;

/**
 * Uma pergunta avulsa ao Claude: sem ferramentas, sem configurações do usuário, sem histórico gravado e com um
 * prompt de sistema próprio e curto (o do Claude Code seria dezenas de milhares de tokens a mais). Devolve o texto
 * da resposta ou falha com o motivo.
 */
export async function askClaudeOnce(args: AskOnceArgs): Promise<string> {
  const abort = new AbortController();
  const query = args.createQuery({
    prompt: args.prompt,
    options: {
      pathToClaudeCodeExecutable: args.cliPath,
      env: childEnv(args.env),
      cwd: args.cwd,
      model: args.model ?? 'haiku',
      systemPrompt: args.system,
      tools: [],
      settingSources: [],
      maxTurns: 1,
      persistSession: false,
      thinking: { type: 'disabled' },
      abortController: abort,
    },
  });
  const timer = setTimeout(() => abort.abort(), args.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    for await (const message of query) {
      if (message.type !== 'result') continue;
      if (message.subtype === 'success' && !message.is_error) return message.result;
      throw new Error('O Claude não conseguiu responder.');
    }
    throw new Error(abort.signal.aborted ? 'O Claude demorou demais.' : 'O Claude não respondeu.');
  } finally {
    clearTimeout(timer);
    query.close();
  }
}
