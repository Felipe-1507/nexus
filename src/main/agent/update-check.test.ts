import { describe, expect, it, vi } from 'vitest';
import { ClaudeUpdateService, fetchLatestVersion } from './update-check';

const ok = (version: unknown) => async () => ({ ok: true, json: async () => ({ version }) });

describe('versão mais nova do Claude Code', () => {
  it('lê a versão publicada e ignora respostas estranhas ou falhas', async () => {
    expect(await fetchLatestVersion(ok('2.1.322'))).toBe('2.1.322');
    expect(await fetchLatestVersion(ok('latest'))).toBeNull();
    expect(await fetchLatestVersion(ok(5))).toBeNull();
    expect(await fetchLatestVersion(async () => ({ ok: false, json: async () => ({}) }))).toBeNull();
    expect(
      await fetchLatestVersion(async () => {
        throw new Error('sem internet');
      }),
    ).toBeNull();
  });

  it('avisa só quando a versão publicada é maior que a instalada', async () => {
    const service = new ClaudeUpdateService({ fetch: ok('2.1.322') });
    expect(await service.check('2.1.295')).toEqual({ current: '2.1.295', latest: '2.1.322', available: true });
    expect(await service.check('2.1.322')).toMatchObject({ available: false });
    expect(await service.check('2.2.0')).toMatchObject({ available: false });
    expect(await service.check(null)).toMatchObject({ available: false });
  });

  it('guarda a resposta por 6 horas, refaz quando pedido e mantém o último resultado se a internet cair', async () => {
    let clock = 0;
    const fetchFn = vi.fn(ok('2.1.322'));
    const service = new ClaudeUpdateService({ fetch: fetchFn, now: () => clock });
    await service.check('2.1.295');
    clock += 60 * 60_000;
    await service.check('2.1.295');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await service.check('2.1.295', true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    clock += 7 * 60 * 60_000;
    fetchFn.mockRejectedValueOnce(new Error('offline'));
    expect(await service.check('2.1.295')).toMatchObject({ latest: '2.1.322', available: true });
  });
});
