import type { ClaudeUpdate } from '@shared/claude';
import { compareVersions } from './cli-detector';

/** Última versão publicada do Claude Code (o mesmo pacote que o instalador oficial distribui). */
export const LATEST_URL = 'https://registry.npmjs.org/@anthropic-ai/claude-code/latest';

const TIMEOUT_MS = 6_000;
/** A checagem na internet é refeita no máximo a cada 6 horas, a menos que o usuário peça. */
const TTL_MS = 6 * 60 * 60_000;

type FetchLike = (
  url: string,
  init: { signal: AbortSignal; headers: Record<string, string> },
) => Promise<{
  ok: boolean;
  json: () => Promise<unknown>;
}>;

/** Lê a versão mais nova. Qualquer falha (sem internet, resposta estranha) devolve `null`: nunca atrapalha o app. */
export async function fetchLatestVersion(fetchFn: FetchLike): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchFn(LATEST_URL, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === 'string' && /^\d+\.\d+\.\d+$/.test(body.version) ? body.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Compara a versão instalada com a mais nova, guardando a resposta da internet por algumas horas. */
export class ClaudeUpdateService {
  private cache: { at: number; latest: string | null } | null = null;

  constructor(private readonly deps: { fetch: FetchLike; now?: () => number }) {}

  async check(current: string | null, refresh = false): Promise<ClaudeUpdate> {
    // Sem Claude Code instalado não há o que comparar (e nada é pedido à internet).
    if (!current) return { current: null, latest: this.cache?.latest ?? null, available: false };
    const now = (this.deps.now ?? Date.now)();
    if (refresh || !this.cache || now - this.cache.at > TTL_MS) {
      const latest = await fetchLatestVersion(this.deps.fetch);
      // Uma falha não apaga o último resultado bom.
      this.cache = { at: now, latest: latest ?? this.cache?.latest ?? null };
      if (!latest) this.cache.at = now - TTL_MS + 10 * 60_000; // tenta de novo em 10 minutos
    }
    const latest = this.cache.latest;
    return {
      current,
      latest,
      available: Boolean(current && latest && compareVersions(latest, current) > 0),
    };
  }
}
