import type { ApiRetry } from '@shared/chat';

/**
 * Textos do aviso "o Claude está demorando" (resposta em andamento sem nenhum sinal). Dizem o que o Nexus sabe de
 * verdade: se o Claude Code está tentando de novo (com o motivo) e quão grande é a conversa. Nada é estimado.
 */

/** Contexto a partir do qual a demora é provavelmente do tamanho da conversa (cada chamada relê tudo). */
export const BIG_CONTEXT_TOKENS = 400_000;

const REASONS: Record<string, string> = {
  rate_limit: 'o limite de uso do plano foi atingido',
  overloaded: 'os servidores do Claude estão sobrecarregados',
  server_error: 'erro nos servidores do Claude',
  authentication_failed: 'a conta precisa entrar de novo',
  invalid_request: 'pedido recusado pela API',
  unknown: 'falha sem motivo informado',
};

const seconds = (ms: number) => Math.max(1, Math.round(ms / 1000));

function duration(ms: number): string {
  const s = seconds(ms);
  if (s < 90) return `${s} s`;
  return `${Math.round(s / 60)} min`;
}

/** "A API não respondeu há 10 min (tentativa 1 de 3). Nova tentativa em 5 s." */
export function describeRetry(retry: ApiRetry): string {
  const why =
    retry.noResponseMs !== null
      ? `a API não respondeu em ${duration(retry.noResponseMs)}`
      : (REASONS[retry.error] ?? `erro ${retry.error}${retry.status ? ` (${retry.status})` : ''}`);
  return `O Claude Code está tentando de novo: ${why} (tentativa ${retry.attempt} de ${retry.maxRetries}). Próxima em ${duration(retry.delayMs)}.`;
}

/** Aviso de contexto grande, só quando faz sentido ligar a demora a ele. */
export function describeBigContext(contextTokens: number | null | undefined): string | null {
  if (contextTokens == null || contextTokens < BIG_CONTEXT_TOKENS) return null;
  const mil = Math.round(contextTokens / 1000).toLocaleString('pt-BR');
  return `Esta conversa tem ${mil} mil tokens de contexto e cada chamada ao Claude relê tudo, o que pode levar minutos. Se não andar, pare e use "Continuar em nova conversa".`;
}
