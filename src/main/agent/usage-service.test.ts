import type { SDKControlGetUsageResponse } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import { projectExhaustion, usageLevel } from '@shared/usage';
import { toUsage, UsageService, type CreateUsageQuery } from './usage-service';

const NOW = Date.parse('2026-11-04T13:00:00Z');
const HOUR = 3_600_000;

const pro = (limits: Record<string, unknown> | null, available = true) =>
  ({
    session: {},
    subscription_type: 'pro',
    rate_limits_available: available,
    rate_limits: limits,
  }) as unknown as SDKControlGetUsageResponse;

describe('uso do plano', () => {
  it('traduz as janelas da assinatura e ignora as que não existem na conta', () => {
    const usage = toUsage(
      pro({
        five_hour: { utilization: 35, resets_at: '2026-11-04T16:09:59Z' },
        seven_day: { utilization: 11, resets_at: '2026-11-10T17:59:59Z' },
        seven_day_opus: null,
        seven_day_sonnet: { utilization: null, resets_at: null },
        iguana_necktie: { utilization: 99 },
      }),
      new Date(NOW),
    );
    expect(usage).toEqual({
      available: true,
      plan: 'pro',
      windows: [
        { id: 'five_hour', percent: 35, resetsAt: '2026-11-04T16:09:59Z' },
        { id: 'seven_day', percent: 11, resetsAt: '2026-11-10T17:59:59Z' },
      ],
      checkedAt: new Date(NOW).toISOString(),
    });
  });

  it('com chave de API ou sem limites de plano, não há o que mostrar', () => {
    expect(toUsage(pro(null, false), new Date(NOW))).toMatchObject({ available: false, windows: [] });
    expect(toUsage(pro({ five_hour: null }), new Date(NOW))).toMatchObject({ available: false });
  });

  it('limita a porcentagem a 0–100', () => {
    const usage = toUsage(pro({ five_hour: { utilization: 140, resets_at: null } }), new Date(NOW));
    expect(usage.windows[0]).toMatchObject({ percent: 100, resetsAt: null });
  });

  it('guarda a leitura por um minuto, deixa forçar uma nova e fecha o processo sempre', async () => {
    const close = vi.fn();
    const usageFn = vi.fn(async () => pro({ five_hour: { utilization: 10, resets_at: null } }));
    const createQuery: CreateUsageQuery = () => ({
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: usageFn,
      close,
    });
    let now = NOW;
    const service = new UsageService({ createQuery, env: { ANTHROPIC_API_KEY: 'x' }, cwd: 'C:\\x', now: () => now });

    await service.get('claude.exe');
    await service.get('claude.exe');
    expect(usageFn).toHaveBeenCalledTimes(1);
    now += 61_000;
    await service.get('claude.exe');
    expect(usageFn).toHaveBeenCalledTimes(2);
    await service.get('claude.exe', true);
    expect(usageFn).toHaveBeenCalledTimes(3);
    expect(close).toHaveBeenCalledTimes(3);
  });

  it('uma falha não fica guardada: a próxima tentativa lê de novo', async () => {
    let fail = true;
    const createQuery: CreateUsageQuery = () => ({
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => {
        if (fail) throw new Error('sem rede');
        return pro({ five_hour: { utilization: 5, resets_at: null } });
      },
      close: () => {},
    });
    const service = new UsageService({ createQuery, env: {}, cwd: 'C:\\x', now: () => NOW });
    await expect(service.get('claude.exe')).rejects.toThrow('sem rede');
    fail = false;
    await expect(service.get('claude.exe')).resolves.toMatchObject({ available: true });
  });
});

describe('faixas e projeção', () => {
  it('avisa a partir de 70% e fica crítico a partir de 90%', () => {
    expect([0, 69, 70, 89, 90, 100].map(usageLevel)).toEqual(['ok', 'ok', 'warn', 'warn', 'danger', 'danger']);
  });

  it('projeta quando o limite acaba no ritmo atual, só se acabar antes do reinício', () => {
    // 3 h decorridas de 5 h (reinicia em 2 h) e 60% usado: 1%/3 min → os 40% restantes acabam em 2 h... no reinício.
    const reset = new Date(NOW + 2 * HOUR).toISOString();
    expect(projectExhaustion(60, reset, 5 * HOUR, NOW)).toBeNull();
    // 80% em 3 h: restam 20% → 45 min, bem antes do reinício.
    const at = projectExhaustion(80, reset, 5 * HOUR, NOW)!.at;
    expect(at - NOW).toBeCloseTo(0.75 * HOUR, -3);
  });

  it('sem dados suficientes, não projeta', () => {
    const reset = new Date(NOW + 2 * HOUR).toISOString();
    expect(projectExhaustion(5, reset, 5 * HOUR, NOW)).toBeNull(); // pouco uso
    expect(projectExhaustion(100, reset, 5 * HOUR, NOW)).toBeNull(); // já acabou
    expect(projectExhaustion(50, null, 5 * HOUR, NOW)).toBeNull(); // sem hora de reinício
    expect(projectExhaustion(50, new Date(NOW - HOUR).toISOString(), 5 * HOUR, NOW)).toBeNull(); // janela já reiniciou
    // Acabou de abrir a janela: 40% em 10 minutos não é um ritmo.
    expect(projectExhaustion(40, new Date(NOW + 4.8 * HOUR).toISOString(), 5 * HOUR, NOW)).toBeNull();
  });
});

describe('hora do reinício', () => {
  it('mostra só a hora quando é hoje e a data quando é outro dia', async () => {
    const { formatResetTime } = await import('@shared/usage');
    const now = new Date(2026, 10, 4, 10, 0).getTime();
    expect(formatResetTime(new Date(2026, 10, 4, 13, 9).toISOString(), now)).toBe('às 13:09');
    expect(formatResetTime(new Date(2026, 10, 10, 17, 59).toISOString(), now)).toBe('em 10/11 às 17:59');
  });
});
