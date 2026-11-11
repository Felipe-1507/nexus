import { describe, expect, it, vi } from 'vitest';
import { AmbientClock, ambientFrameDue, ambientInterval } from './ambient';
import { GALAXY_PROFILES } from './quality';

const state = (over: Partial<Parameters<typeof ambientInterval>[0]> = {}) => ({
  fps: 30,
  unfocusedFps: 0,
  focused: true,
  reducedMotion: false,
  ...over,
});

/** Quantos quadros ambientes um segundo de requestAnimationFrame a 60 Hz desenharia. */
function framesInOneSecond(interval: number | null): number {
  let last = -Infinity;
  let drawn = 0;
  for (let k = 0; k < 60; k++) {
    const t = (k * 1000) / 60;
    if (ambientFrameDue(t, last, interval)) {
      drawn++;
      last = t;
    }
  }
  return drawn;
}

describe('movimento ambiente', () => {
  it('limita os quadros pelo perfil', () => {
    const leve = GALAXY_PROFILES.leve;
    const original = GALAXY_PROFILES.original;
    expect(framesInOneSecond(ambientInterval(state({ fps: leve.ambientFps })))).toBe(30);
    expect(framesInOneSecond(ambientInterval(state({ fps: original.ambientFps })))).toBe(60);
  });

  it('sem foco: o Leve para e o Original desacelera', () => {
    const leve = GALAXY_PROFILES.leve;
    const original = GALAXY_PROFILES.original;
    expect(ambientInterval(state({ focused: false, unfocusedFps: leve.unfocusedFps }))).toBeNull();
    expect(framesInOneSecond(ambientInterval(state({ focused: false, unfocusedFps: original.unfocusedFps })))).toBe(30);
  });

  it('movimento reduzido para tudo, nos dois modos', () => {
    expect(ambientInterval(state({ reducedMotion: true, fps: 60 }))).toBeNull();
    expect(framesInOneSecond(null)).toBe(0);
  });

  it('o relógio avança as animações e tira as que terminaram', () => {
    const clock = new AmbientClock();
    const forever = { update: vi.fn(() => true) };
    let left = 2;
    const twice = { update: vi.fn(() => --left > 0) };
    const remove = clock.add(forever);
    clock.add(twice);
    clock.tick(0.016, 0);
    clock.tick(0.016, 16);
    expect(clock.size).toBe(1);
    expect(twice.update).toHaveBeenCalledTimes(2);
    remove();
    expect(clock.size).toBe(0);
  });

  it('o Leve nunca pede mais que o Original', () => {
    const l = GALAXY_PROFILES.leve;
    const o = GALAXY_PROFILES.original;
    expect(l.ambientFps).toBeLessThanOrEqual(o.ambientFps);
    expect(l.maxPixelRatio).toBeLessThanOrEqual(o.maxPixelRatio);
    expect(l.backgroundStars).toBeLessThanOrEqual(o.backgroundStars);
    for (const k of Object.keys(l.limits) as Array<keyof typeof l.limits>)
      expect(l.limits[k]).toBeLessThanOrEqual(o.limits[k]);
  });
});

describe('ritmo do movimento', () => {
  it('o relógio sabe quando há movimento rápido (para pedir o ritmo cheio do perfil)', () => {
    const clock = new AmbientClock();
    let fast = false;
    clock.add({ update: () => true });
    clock.add({
      get fast() {
        return fast;
      },
      update: () => true,
    });
    expect(clock.fast).toBe(false);
    fast = true;
    expect(clock.fast).toBe(true);
  });

  it('movimento lento no Leve fica abaixo do rápido', () => {
    expect(GALAXY_PROFILES.leve.idleFps).toBeLessThan(GALAXY_PROFILES.leve.ambientFps);
    expect(GALAXY_PROFILES.leve.nearStars).toBeLessThan(GALAXY_PROFILES.original.nearStars);
    expect(GALAXY_PROFILES.leve.shootingStarEverySec).toBeGreaterThan(GALAXY_PROFILES.original.shootingStarEverySec);
  });
});
