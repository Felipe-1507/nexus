import { describe, expect, it } from 'vitest';
import { ShaderMaterial } from 'three';
import type { Animator } from './ambient';
import { ActivityLayer, type Spot } from './activity-effects';
import { seeded } from './effects';
import { noteInVault } from './layout';
import { GALAXY_PROFILES } from './quality';

function setup(quality: 'leve' | 'original' = 'leve', known: string[] = ['A/x.md', 'A/y.md', 'B/z.md']) {
  const spots = new Map<string, Spot>(known.map((p, i) => [p, { x: i * 20, y: 0, z: 0, size: 1 }]));
  let animator: Animator | null = null;
  const layer = new ActivityLayer({
    material: new ShaderMaterial(),
    profile: () => GALAXY_PROFILES[quality],
    locate: (p) => spots.get(p) ?? null,
    locateSystem: () => ({ x: 0, y: 0, z: 0, size: 2 }),
    radius: () => 100,
    rand: seeded(3),
    start: (a) => {
      animator = a;
      return () => (animator = null);
    },
  });
  /** Avança o relógio até a camada parar (ou o limite de tempo). */
  const run = (seconds: number) => {
    for (let t = 0; t < seconds && animator; t += 0.05) if (!animator.update(0.05, t * 1000)) animator = null;
  };
  return { layer, spots, run, running: () => animator !== null };
}

describe('eventos do Claude na galáxia', () => {
  it('edições seguidas viram fila na mesma nave (agrupamento), até o limite de naves do perfil', () => {
    const { layer } = setup('leve'); // Leve: 2 naves do Claude
    for (const p of ['A/x.md', 'A/y.md', 'B/z.md', 'A/w.md']) layer.claudeEdit(p);
    expect(layer.activeShips).toBe(2);
    expect(layer.pendingJobs).toBe(4);
    expect(layer.stats.grouped).toBe(2);
    // A mesma nota de novo, ainda em andamento, não cria trabalho repetido.
    layer.claudeEdit('a/X.md');
    expect(layer.pendingJobs).toBe(4);
  });

  it('a nave chega, emite o feixe até o arquivo ser gravado, o planeta pulsa e a nave vai embora', () => {
    const { layer, run, running } = setup('original');
    layer.claudeEdit('A/x.md');
    run(6);
    // Chegou e está com o feixe ligado esperando a gravação (o feixe dura no máximo 10 s).
    expect(layer.activeShips).toBe(1);
    expect(layer.stats.pulses).toBe(0);
    layer.notesChanged([{ path: 'A/x.md', existed: true }]);
    run(2);
    expect(layer.stats.pulses).toBe(1);
    expect(layer.pendingJobs).toBe(0);
    run(10);
    expect(layer.activeShips).toBe(0);
    expect(running()).toBe(false);
  });

  it('nota alterada por fora só pulsa, no máximo uma vez a cada poucos segundos por nota', () => {
    const { layer } = setup();
    layer.notesChanged([{ path: 'A/x.md', existed: true }]);
    layer.notesChanged([{ path: 'A/x.md', existed: true }]);
    layer.notesChanged([{ path: 'A/y.md', existed: true }]);
    expect(layer.stats.pulses).toBe(2);
    expect(layer.activeShips).toBe(0);
  });

  it('pulsos simultâneos respeitam o limite do perfil', () => {
    const { layer } = setup('leve');
    layer.notesChanged(Array.from({ length: 50 }, (_, i) => ({ path: `N/${i}.md`, existed: false })));
    expect(layer.stats.pulses).toBe(GALAXY_PROFILES.leve.limits.pulses);
  });

  it('nota nova: a nave vai à estrela do sistema e o pulso espera a nota aparecer na galáxia', () => {
    const { layer, spots, run } = setup('original');
    layer.claudeEdit('A/nova.md');
    run(5);
    layer.notesChanged([{ path: 'A/nova.md', existed: false }]);
    spots.set('A/nova.md', { x: 5, y: 0, z: 5, size: 0.8 });
    run(3);
    expect(layer.stats.pulses).toBe(1);
  });
});

describe('arquivo do Claude → nota do vault', () => {
  const vault = 'C:\\Users\\x\\Nexus\\Conhecimentos';
  it('aceita notas dentro do vault, sem diferenciar maiúsculas nem barras', () => {
    expect(noteInVault(vault, 'C:\\Users\\x\\Nexus\\Conhecimentos\\Fiscal\\ST.md')).toBe('Fiscal/ST.md');
    expect(noteInVault(vault, 'c:/users/x/nexus/conhecimentos/Nota.MD')).toBe('Nota.MD');
  });
  it('recusa arquivos fora do vault, que não são notas, ou com caminho estranho', () => {
    expect(noteInVault(vault, 'C:\\Users\\x\\Nexus\\Conhecimentos2\\a.md')).toBeNull();
    expect(noteInVault(vault, 'C:\\dev\\projeto\\README.md')).toBeNull();
    expect(noteInVault(vault, 'C:\\Users\\x\\Nexus\\Conhecimentos\\script.ts')).toBeNull();
    expect(noteInVault(vault, 'C:\\Users\\x\\Nexus\\Conhecimentos\\..\\fora.md')).toBeNull();
  });
});
