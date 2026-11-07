const pad = (n: number) => String(n).padStart(2, '0');
const clock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * Horário curto de uma mensagem, no fuso do computador: só a hora no próprio dia ("14:32"), "ontem 14:32", depois
 * "07/11 14:32" e, de outro ano, "07/11/2025 14:32". Texto inválido devolve vazio.
 */
export function formatMessageTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days === 0) return clock(d);
  if (days === 1) return `ontem ${clock(d)}`;
  const date = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  return d.getFullYear() === now.getFullYear() ? `${date} ${clock(d)}` : `${date}/${d.getFullYear()} ${clock(d)}`;
}

/** Data e hora completas, para a dica ao passar o mouse ("sábado, 7 de novembro de 2026, 14:32:05"). */
export function formatFullTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full', timeStyle: 'medium' }).format(d);
}
