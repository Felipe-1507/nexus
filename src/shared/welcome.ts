import { z } from 'zod';

/**
 * Tela de boas-vindas: na primeira abertura do dia, saudação e um resumo do que mudou nos sistemas e projetos desde
 * a última vez. As frases-base (saudação, dia da semana) são calculadas aqui, sem IA; o resumo vem do que o Nexus
 * já tem (commits, notas, conversas) e, se o usuário deixar, o Claude só reescreve esses fatos em poucas frases.
 */

export const WELCOME_NAME_MAX = 40;

export const welcomeSettingsSchema = z.object({
  /** Mostrar a tela na primeira abertura do dia. */
  enabled: z.boolean(),
  /** Deixar o Claude (modelo pequeno) escrever o resumo. Desligado, o resumo é montado só com regras locais. */
  ai: z.boolean(),
  /** Nome na saudação; `null` = o primeiro nome do `git config user.name`, se houver. */
  name: z.string().trim().max(WELCOME_NAME_MAX).nullable(),
});
export type WelcomeSettings = z.infer<typeof welcomeSettingsSchema>;

/** Se a tela deve aparecer agora e com que saudação. */
export const welcomeDueSchema = z.object({
  due: z.boolean(),
  /** "Bom dia, Ana." */
  greeting: z.string(),
  /** "Uma ótima quinta-feira." */
  weekday: z.string(),
  /** Início do período resumido (ISO). */
  since: z.string(),
  /** "Desde ontem". */
  sinceLabel: z.string(),
});
export type WelcomeDue = z.infer<typeof welcomeDueSchema>;

export const welcomeItemSchema = z.object({
  /** Sistema ou projeto ("NOME", "PedidosTurbo"…). */
  topic: z.string(),
  text: z.string(),
});
export type WelcomeItem = z.infer<typeof welcomeItemSchema>;

export const welcomeRecapSchema = z.object({
  items: z.array(welcomeItemSchema),
  counts: z.object({ commits: z.number(), notes: z.number(), conversations: z.number() }),
  /** `claude`: o texto foi reescrito pelo Claude; `local`: montado só com regras. */
  source: z.enum(['claude', 'local']),
});
export type WelcomeRecap = z.infer<typeof welcomeRecapSchema>;

const DAY_MS = 86_400_000;
/** Sem abertura anterior registrada, o resumo cobre este período. */
export const WELCOME_FIRST_DAYS = 3;
/** Mesmo depois de muito tempo parado, o resumo cobre no máximo este período. */
export const WELCOME_MAX_DAYS = 7;

const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

const startOfDay = (ms: number) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** Mesmo dia de calendário (fuso do computador). */
export function sameLocalDay(aMs: number, bMs: number): boolean {
  return startOfDay(aMs) === startOfDay(bMs);
}

/** "Bom dia, Ana." (ou só "Bom dia." sem nome). */
export function greetingFor(now: Date, name: string | null): string {
  const hour = now.getHours();
  const part = hour < 5 ? 'Boa noite' : hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  return name ? `${part}, ${name}.` : `${part}.`;
}

/** "Uma ótima quinta-feira." / "Um ótimo sábado." */
export function weekdayPhrase(now: Date): string {
  const day = now.getDay();
  const weekend = day === 0 || day === 6;
  return `${weekend ? 'Um ótimo' : 'Uma ótima'} ${WEEKDAYS[day]}.`;
}

/** Início do período a resumir: desde a última tela (limitado a uma semana) ou os últimos dias, na primeira vez. */
export function sinceFor(lastShownAt: string | null, nowMs: number): number {
  const first = nowMs - WELCOME_FIRST_DAYS * DAY_MS;
  const parsed = lastShownAt ? Date.parse(lastShownAt) : NaN;
  if (Number.isNaN(parsed)) return first;
  return Math.min(Math.max(parsed, nowMs - WELCOME_MAX_DAYS * DAY_MS), nowMs);
}

/** "Desde ontem", "Desde segunda-feira" ou "Nos últimos 3 dias" (primeira vez). */
export function sinceLabel(sinceMs: number, nowMs: number, first: boolean): string {
  if (first) return `Nos últimos ${WELCOME_FIRST_DAYS} dias`;
  const days = Math.round((startOfDay(nowMs) - startOfDay(sinceMs)) / DAY_MS);
  if (days <= 0) return 'Desde mais cedo hoje';
  if (days === 1) return 'Desde ontem';
  if (days === 2) return 'Desde anteontem';
  return `Desde ${WEEKDAYS[new Date(sinceMs).getDay()]}`;
}
