import { describe, expect, it } from 'vitest';
import {
  CACHE_TTL_MS,
  cacheStatus,
  contextLevel,
  contextPercent,
  contextThresholdsSchema,
  DEFAULT_CONTEXT_THRESHOLDS,
  formatIdle,
  formatTokens,
  shouldWarnCache,
  type ContextSnapshot,
} from './context';

function snap(over: Partial<ContextSnapshot> = {}): ContextSnapshot {
  return {
    conversationId: 'c',
    source: 'live',
    model: 'claude-sonnet-5-5',
    contextTokens: 100_000,
    inputTokens: 2,
    cacheReadTokens: 99_000,
    cacheCreationTokens: 998,
    windowTokens: 1_000_000,
    windowSource: 'turn',
    lastCallAt: '2026-11-04T12:00:00.000Z',
    cacheRebuilt: false,
    costUsd: null,
    lastCompaction: null,
    ...over,
  };
}

describe('percentual de ocupação', () => {
  it('divide o contexto pela janela informada pelo modelo', () => {
    expect(contextPercent(snap({ contextTokens: 250_000, windowTokens: 1_000_000 }))).toBe(25);
  });

  it('sem o tamanho do contexto ou sem a janela, não há percentual (nada é presumido)', () => {
    expect(contextPercent(snap({ contextTokens: null }))).toBeNull();
    expect(contextPercent(snap({ windowTokens: null }))).toBeNull();
    expect(contextPercent(snap({ windowTokens: 0 }))).toBeNull();
  });
});

describe('faixas de contexto', () => {
  const t = DEFAULT_CONTEXT_THRESHOLDS;

  it('usa 50 / 75 / 90 por padrão, com o limite exato já na faixa seguinte', () => {
    expect(contextLevel(0, t)).toBe('normal');
    expect(contextLevel(49.9, t)).toBe('normal');
    expect(contextLevel(50, t)).toBe('attention');
    expect(contextLevel(74.9, t)).toBe('attention');
    expect(contextLevel(75, t)).toBe('high');
    expect(contextLevel(89.9, t)).toBe('high');
    expect(contextLevel(90, t)).toBe('critical');
    expect(contextLevel(140, t)).toBe('critical');
  });

  it('respeita limites configurados', () => {
    const custom = { attention: 20, high: 40, critical: 60 };
    expect(contextLevel(25, custom)).toBe('attention');
    expect(contextLevel(61, custom)).toBe('critical');
  });

  it('sem percentual, não há faixa', () => {
    expect(contextLevel(null, t)).toBeNull();
  });

  it('só aceita limites em ordem crescente', () => {
    expect(contextThresholdsSchema.safeParse({ attention: 50, high: 75, critical: 90 }).success).toBe(true);
    expect(contextThresholdsSchema.safeParse({ attention: 80, high: 75, critical: 90 }).success).toBe(false);
    expect(contextThresholdsSchema.safeParse({ attention: 50, high: 50, critical: 90 }).success).toBe(false);
    expect(contextThresholdsSchema.safeParse({ attention: 0, high: 75, critical: 90 }).success).toBe(false);
  });
});

describe('situação do cache', () => {
  const at = Date.parse('2026-11-04T12:00:00.000Z');

  it('com atividade há menos de 1 h, o cache provavelmente está valendo', () => {
    expect(cacheStatus(snap(), at + 10 * 60_000)).toEqual({ state: 'active', idleMs: 10 * 60_000 });
  });

  it('a partir de 1 h parada, diz apenas que pode ter expirado', () => {
    expect(cacheStatus(snap(), at + CACHE_TTL_MS).state).toBe('maybe-expired');
    expect(cacheStatus(snap(), at + 5 * CACHE_TTL_MS).state).toBe('maybe-expired');
  });

  it('sem horário da última chamada, a situação é desconhecida', () => {
    expect(cacheStatus(snap({ lastCallAt: null }), at)).toEqual({ state: 'unknown', idleMs: null });
    expect(cacheStatus(null, at).state).toBe('unknown');
    expect(cacheStatus(snap({ lastCallAt: 'lixo' }), at).state).toBe('unknown');
  });

  it('um relógio um pouco atrasado não gera tempo negativo', () => {
    expect(cacheStatus(snap(), at - 5000).idleMs).toBe(0);
  });

  it('só avisa para conversa grande e parada', () => {
    const later = at + 2 * CACHE_TTL_MS;
    expect(shouldWarnCache(snap({ contextTokens: 400_000 }), later)).toBe(true);
    expect(shouldWarnCache(snap({ contextTokens: 400_000 }), at + 60_000)).toBe(false);
    expect(shouldWarnCache(snap({ contextTokens: 30_000 }), later)).toBe(false);
    expect(shouldWarnCache(snap({ contextTokens: null }), later)).toBe(false);
    expect(shouldWarnCache(null, later)).toBe(false);
  });
});

describe('formatação', () => {
  it('abrevia tokens em pt-BR e assume "indisponível" para ausente', () => {
    expect(formatTokens(null)).toBe('indisponível');
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(1500)).toBe('1,5 mil');
    expect(formatTokens(448_061)).toBe('448 mil');
    expect(formatTokens(1_250_000)).toBe('1,25 mi');
  });

  it('descreve o tempo parado', () => {
    expect(formatIdle(20_000)).toBe('agora há pouco');
    expect(formatIdle(5 * 60_000)).toBe('há 5 min');
    expect(formatIdle(3 * 3_600_000)).toBe('há 3 h');
    expect(formatIdle(50 * 3_600_000)).toBe('há 2 d');
  });
});
