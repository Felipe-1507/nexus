import { describe, expect, it } from 'vitest';
import { GALAXY_PROFILES } from './quality';

describe('perfis da galáxia', () => {
  it('só Alta e Ultra ligam o pós-processamento', () => {
    expect(GALAXY_PROFILES.leve.post).toBeNull();
    expect(GALAXY_PROFILES.original.post).toBeNull();
    expect(GALAXY_PROFILES.alta.post).not.toBeNull();
    expect(GALAXY_PROFILES.ultra.post).not.toBeNull();
  });

  it('cada perfil se identifica pelo próprio nome e o Ultra desenha mais que o Original', () => {
    for (const [id, p] of Object.entries(GALAXY_PROFILES)) expect(p.quality).toBe(id);
    expect(GALAXY_PROFILES.ultra.backgroundStars).toBeGreaterThan(GALAXY_PROFILES.original.backgroundStars);
    expect(GALAXY_PROFILES.ultra.post!.bloom.strength).toBeGreaterThan(GALAXY_PROFILES.alta.post!.bloom.strength);
  });
});
