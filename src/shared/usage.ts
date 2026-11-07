import { z } from 'zod';

/** Janelas de limite do plano do claude.ai, na ordem em que aparecem. */
export const USAGE_WINDOWS = {
  five_hour: { label: 'Sessão (5 h)', ms: 5 * 3_600_000 },
  seven_day: { label: 'Semana', ms: 7 * 24 * 3_600_000 },
  seven_day_opus: { label: 'Semana (Opus)', ms: 7 * 24 * 3_600_000 },
  seven_day_sonnet: { label: 'Semana (Sonnet)', ms: 7 * 24 * 3_600_000 },
} as const;
export type UsageWindowId = keyof typeof USAGE_WINDOWS;

export const usageWindowSchema = z.object({
  id: z.enum(['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet']),
  /** Quanto da janela já foi usado, de 0 a 100. */
  percent: z.number(),
  /** Quando a janela reinicia (ISO 8601). */
  resetsAt: z.string().nullable(),
});
export type UsageWindow = z.infer<typeof usageWindowSchema>;

/**
 * Uso do plano do claude.ai. Só existe para contas com assinatura (Pro, Max…): com chave de API ou outro provedor,
 * `available` é falso e não há janelas para mostrar.
 */
export const usageSchema = z.object({
  available: z.boolean(),
  plan: z.string().nullable(),
  windows: z.array(usageWindowSchema),
  /** Quando o Nexus leu estes números (ISO 8601). */
  checkedAt: z.string(),
});
export type Usage = z.infer<typeof usageSchema>;

/** Faixa de alerta: até 69% normal, 70% a 89% atenção, 90% ou mais crítico. */
export function usageLevel(percent: number): 'ok' | 'warn' | 'danger' {
  if (percent >= 90) return 'danger';
  if (percent >= 70) return 'warn';
  return 'ok';
}

/**
 * Projeção de quando o limite acaba, no ritmo de uso até agora: `usado / tempo decorrido` continua igual até 100%.
 * Devolve `null` quando a projeção não é confiável (pouco uso, pouco tempo decorrido) ou quando o limite só acabaria
 * depois do reinício da janela, ou seja, não vai acabar.
 */
export function projectExhaustion(
  percent: number,
  resetsAt: string | null,
  windowMs: number,
  now: number,
): { at: number } | null {
  if (!resetsAt || percent < 10 || percent >= 100) return null;
  const reset = Date.parse(resetsAt);
  if (!Number.isFinite(reset) || reset <= now) return null;
  const elapsed = windowMs - (reset - now);
  // Menos de 5% da janela decorrido: o ritmo ainda não diz nada (uma pergunta grande faz a projeção disparar).
  if (elapsed < windowMs * 0.05) return null;
  const at = now + (elapsed * (100 - percent)) / percent;
  return at < reset ? { at } : null;
}

/** "às 13:09" se reinicia hoje; "em 10/11 às 17:59" se for em outro dia. */
export function formatResetTime(iso: string, now: number): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const sameDay = date.toDateString() === new Date(now).toDateString();
  if (sameDay) return `às ${time}`;
  return `em ${date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${time}`;
}
