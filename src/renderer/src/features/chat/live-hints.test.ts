import { describe, expect, it } from 'vitest';
import { BIG_CONTEXT_TOKENS, describeBigContext, describeRetry } from './live-hints';

const retry = { attempt: 2, maxRetries: 10, delayMs: 8_000, status: 529, error: 'overloaded', noResponseMs: null };

describe('describeRetry', () => {
  it('traduz o motivo conhecido e mostra a tentativa e a espera', () => {
    expect(describeRetry(retry)).toBe(
      'O Claude Code está tentando de novo: os servidores do Claude estão sobrecarregados (tentativa 2 de 10). Próxima em 8 s.',
    );
    expect(describeRetry({ ...retry, error: 'rate_limit', status: 429 })).toContain('limite de uso do plano');
  });

  it('quando a API nem começou a responder, diz há quanto tempo', () => {
    expect(describeRetry({ ...retry, error: 'unknown', status: null, noResponseMs: 600_000, delayMs: 2_000 })).toBe(
      'O Claude Code está tentando de novo: a API não respondeu em 10 min (tentativa 2 de 10). Próxima em 2 s.',
    );
    expect(describeRetry({ ...retry, noResponseMs: 45_000 })).toContain('não respondeu em 45 s');
  });

  it('motivo desconhecido aparece como veio, com o status', () => {
    expect(describeRetry({ ...retry, error: 'coisa_nova', status: 503 })).toContain('erro coisa_nova (503)');
  });
});

describe('describeBigContext', () => {
  it('só avisa a partir do limite e mostra o tamanho', () => {
    expect(describeBigContext(null)).toBeNull();
    expect(describeBigContext(BIG_CONTEXT_TOKENS - 1)).toBeNull();
    expect(describeBigContext(674_000)).toContain('674 mil tokens');
    expect(describeBigContext(674_000)).toContain('Continuar em nova conversa');
  });
});
