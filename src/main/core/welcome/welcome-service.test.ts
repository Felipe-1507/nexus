import { describe, expect, it, vi } from 'vitest';
import { preferencesSchema, type Preferences } from '../../platform/preferences';
import { WelcomeService, type WelcomeDeps } from './welcome-service';

const NOW = new Date(2026, 10, 19, 9, 0, 0).getTime();
const DAY = 86_400_000;
const WS = '11111111-1111-4111-8111-111111111111';

function setup(over: Partial<WelcomeDeps> = {}, prefs: Partial<Preferences> = {}) {
  let current = preferencesSchema.parse(prefs);
  const deps: WelcomeDeps = {
    prefs: {
      get: () => current,
      update: (patch) => (current = preferencesSchema.parse({ ...current, ...patch })),
    },
    projects: async () => [{ id: 'p1', name: 'NOME', path: 'C:\\nome' }],
    notes: async () => [
      { title: 'Nota nova', system: 'NOME', mtimeMs: NOW - 3_600_000 },
      { title: 'Nota velha', system: 'NOME', mtimeMs: NOW - 10 * DAY },
    ],
    conversations: () => [
      { title: 'Remessa', projectId: 'p1', updatedAt: new Date(NOW - 7_200_000).toISOString() },
      { title: 'Antiga', projectId: 'p1', updatedAt: new Date(NOW - 9 * DAY).toISOString() },
    ],
    gitLog: async () => ['Baixa em lote'],
    gitUser: async () => 'Ana Souza',
    summarize: async () => null,
    now: () => NOW,
    ...over,
  };
  return { service: new WelcomeService(deps), prefs: () => current, deps };
}

describe('WelcomeService.due', () => {
  it('na primeira abertura aparece, com o primeiro nome do git', async () => {
    const { service } = setup();
    const due = await service.due(false);
    expect(due).toMatchObject({
      due: true,
      greeting: 'Bom dia, Ana.',
      weekday: 'Uma ótima quinta-feira.',
      sinceLabel: 'Nos últimos 3 dias',
    });
  });

  it('o nome das configurações vale mais que o do git', async () => {
    const { service } = setup({}, { welcomeName: 'Fê' });
    expect((await service.due(false)).greeting).toBe('Bom dia, Fê.');
  });

  it('depois de vista hoje não repete, e amanhã volta', async () => {
    const { service, prefs } = setup();
    service.seen();
    expect(prefs().welcomeLastAt).toBe(new Date(NOW).toISOString());
    expect((await service.due(false)).due).toBe(false);
    const tomorrow = setup({ now: () => NOW + DAY }, { welcomeLastAt: new Date(NOW).toISOString() });
    const due = await tomorrow.service.due(false);
    expect(due).toMatchObject({ due: true, sinceLabel: 'Desde ontem' });
  });

  it('desligada nas configurações não aparece, mas "ver agora" força', async () => {
    const { service } = setup({}, { welcomeEnabled: false });
    expect((await service.due(false)).due).toBe(false);
    expect((await service.due(true)).due).toBe(true);
  });

  it('sem git e sem nome, a saudação vem sem nome', async () => {
    const { service } = setup({ gitUser: async () => null });
    expect((await service.due(false)).greeting).toBe('Bom dia.');
  });
});

describe('WelcomeService.recap', () => {
  const since = new Date(NOW - DAY).toISOString();

  it('só conta o que mudou no período e monta o texto local sem chamar o Claude quando está desligado', async () => {
    const summarize = vi.fn(async () => '{"itens":[]}');
    const { service } = setup({ summarize }, { welcomeAi: false });
    const recap = await service.recap(WS, since, 'Desde ontem');
    expect(summarize).not.toHaveBeenCalled();
    expect(recap.source).toBe('local');
    expect(recap.counts).toEqual({ commits: 1, notes: 1, conversations: 1 });
    expect(recap.items).toEqual([
      {
        topic: 'NOME',
        text: '1 commit: "Baixa em lote". 1 nota alterada: "Nota nova". 1 conversa: "Remessa".',
      },
    ]);
  });

  it('com o Claude permitido, usa o texto dele', async () => {
    const summarize = vi.fn(
      async (_system: string, _prompt: string): Promise<string | null> =>
        '{"itens":[{"tema":"NOME","texto":"Baixa em lote pronta."}]}',
    );
    const { service } = setup({ summarize });
    const recap = await service.recap(WS, since, 'Desde ontem');
    expect(recap).toMatchObject({ source: 'claude', items: [{ topic: 'NOME', text: 'Baixa em lote pronta.' }] });
    expect(summarize.mock.calls[0]?.[1]).toContain('## NOME');
  });

  it('se o Claude falhar ou não estiver pronto, cai no texto local e avisa no log', async () => {
    const onWarn = vi.fn();
    const failing = setup({ summarize: async () => Promise.reject(new Error('sem rede')), onWarn });
    expect((await failing.service.recap(WS, since, 'Desde ontem')).source).toBe('local');
    expect(onWarn).toHaveBeenCalledOnce();
    const notReady = setup({ summarize: async () => null });
    expect((await notReady.service.recap(WS, since, 'Desde ontem')).source).toBe('local');
  });

  it('não chama o Claude quando nada mudou', async () => {
    const summarize = vi.fn(async () => '');
    const { service } = setup({ summarize, gitLog: async () => [], notes: async () => [], conversations: () => [] });
    expect(await service.recap(WS, since, 'Desde ontem')).toEqual({
      items: [],
      counts: { commits: 0, notes: 0, conversations: 0 },
      source: 'local',
    });
    expect(summarize).not.toHaveBeenCalled();
  });

  it('erro de git numa pasta não derruba o resumo', async () => {
    const { service } = setup({ gitLog: async () => Promise.reject(new Error('timeout')) }, { welcomeAi: false });
    const recap = await service.recap(WS, since, 'Desde ontem');
    expect(recap.counts.commits).toBe(0);
    expect(recap.counts.notes).toBe(1);
  });
});
