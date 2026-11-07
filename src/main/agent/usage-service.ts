import type { SDKControlGetUsageResponse } from '@anthropic-ai/claude-agent-sdk';
import { USAGE_WINDOWS, type Usage, type UsageWindow, type UsageWindowId } from '@shared/usage';
import { AsyncQueue } from './async-queue';
import { childEnv } from './child-env';

/** O que o serviço precisa do SDK: abrir uma consulta sem mensagem e pedir o uso. */
export interface UsageQuery {
  usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(opts?: {
    skipBehaviors?: boolean;
  }): Promise<SDKControlGetUsageResponse>;
  close(): void;
}
export type CreateUsageQuery = (args: { prompt: AsyncIterable<never>; options: Record<string, unknown> }) => UsageQuery;

const TIMEOUT_MS = 30_000;
/** Abrir o Claude Code custa ~5 s; dentro deste tempo a leitura anterior ainda vale. */
const FRESH_MS = 60_000;

/** Converte a resposta do SDK (marcada como experimental) no que o Nexus mostra. Campos que sumirem viram "sem dados". */
export function toUsage(raw: SDKControlGetUsageResponse, now: Date): Usage {
  const limits = raw.rate_limits as Record<
    string,
    { utilization?: number | null; resets_at?: string | null } | null
  > | null;
  const windows: UsageWindow[] = [];
  if (raw.rate_limits_available && limits) {
    for (const id of Object.keys(USAGE_WINDOWS) as UsageWindowId[]) {
      const w = limits[id];
      if (w && typeof w.utilization === 'number') {
        windows.push({ id, percent: Math.max(0, Math.min(100, w.utilization)), resetsAt: w.resets_at ?? null });
      }
    }
  }
  return {
    available: raw.rate_limits_available && windows.length > 0,
    plan: raw.subscription_type ?? null,
    windows,
    checkedAt: now.toISOString(),
  };
}

/**
 * Uso do plano do claude.ai (janela de 5 horas, semana…). Pergunta ao Claude Code sem mandar mensagem, então não
 * consome tokens. A leitura fica em cache por um minuto, e quem chama pode forçar uma nova (por exemplo, quando uma
 * resposta termina).
 */
export class UsageService {
  private cache: { cliPath: string; at: number; usage: Promise<Usage> } | null = null;

  constructor(
    private readonly deps: {
      createQuery: CreateUsageQuery;
      env: NodeJS.ProcessEnv;
      cwd: string;
      now?: () => number;
    },
  ) {}

  get(cliPath: string, refresh = false): Promise<Usage> {
    const now = (this.deps.now ?? Date.now)();
    if (!refresh && this.cache?.cliPath === cliPath && now - this.cache.at < FRESH_MS) return this.cache.usage;
    const usage = this.fetch(cliPath);
    const entry = { cliPath, at: now, usage };
    this.cache = entry;
    usage.catch(() => {
      if (this.cache === entry) this.cache = null;
    });
    return usage;
  }

  private async fetch(cliPath: string): Promise<Usage> {
    const input = new AsyncQueue<never>();
    const query = this.deps.createQuery({
      prompt: input,
      options: {
        pathToClaudeCodeExecutable: cliPath,
        env: childEnv(this.deps.env),
        cwd: this.deps.cwd,
        persistSession: false,
      },
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const raw = await Promise.race([
        // `skipBehaviors`: pula a leitura de todas as conversas locais, que só serve a outro relatório.
        query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('O Claude Code não informou o uso a tempo.')), TIMEOUT_MS);
        }),
      ]);
      return toUsage(raw, new Date((this.deps.now ?? Date.now)()));
    } finally {
      clearTimeout(timer);
      input.close();
      query.close();
    }
  }
}
