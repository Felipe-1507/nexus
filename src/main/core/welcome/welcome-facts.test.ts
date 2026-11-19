import { describe, expect, it } from 'vitest';
import {
  assembleItems,
  buildTopics,
  countsOf,
  factsPrompt,
  localText,
  parseSummary,
  topicKey,
  type FactSources,
} from './welcome-facts';

const sources: FactSources = {
  projects: [
    { name: 'NOME', commits: ['Baixa em lote com conferência', 'Merge branch x', 'Corrige o fechamento'] },
    { name: 'PedidosTurbo', commits: [] },
  ],
  notes: [
    { title: 'NOME - Regras de negócio', system: 'NOME' },
    { title: 'Mapa dos sistemas', system: '' },
    { title: 'Watchdog - Mapa', system: 'Watchdog' },
  ],
  conversations: [
    { title: 'Remessa bancária', project: 'nome' },
    { title: 'Dúvida solta', project: null },
    { title: '   ', project: null },
  ],
};

describe('topicKey', () => {
  it('ignora acento, caixa e pontuação', () => {
    expect(topicKey('Filtros_MercadoTurbo')).toBe(topicKey('filtros mercadoturbo'));
    expect(topicKey('Conferência')).toBe('conferencia');
  });
});

describe('buildTopics', () => {
  const topics = buildTopics(sources);

  it('junta projeto, pasta de notas e conversas do mesmo nome', () => {
    const nome = topics.find((t) => t.topic === 'NOME');
    expect(nome?.commits).toEqual(['Baixa em lote com conferência', 'Corrige o fechamento']);
    expect(nome?.notes).toEqual(['NOME - Regras de negócio']);
    expect(nome?.conversations).toEqual(['Remessa bancária']);
  });

  it('deixa de fora quem não teve nada (PedidosTurbo) e título de conversa vazio', () => {
    expect(topics.map((t) => t.topic)).not.toContain('PedidosTurbo');
    expect(topics.find((t) => t.topic === 'Geral')?.conversations).toEqual(['Dúvida solta']);
  });

  it('notas soltas viram "Notas gerais" e o tema com mais mudanças vem primeiro', () => {
    expect(topics.map((t) => t.topic)).toContain('Notas gerais');
    expect(topics[0]?.topic).toBe('NOME');
  });

  it('sem nada alterado, nenhum tema', () => {
    expect(buildTopics({ projects: [{ name: 'X', commits: [] }], notes: [], conversations: [] })).toEqual([]);
  });

  it('conta o que entrou no resumo', () => {
    expect(countsOf(topics)).toEqual({ commits: 2, notes: 3, conversations: 2 });
  });
});

describe('texto', () => {
  const topics = buildTopics(sources);

  it('o pedido ao Claude leva só os fatos, por tema', () => {
    const prompt = factsPrompt(topics, 'Desde ontem');
    expect(prompt).toContain('Período: desde ontem até agora.');
    expect(prompt).toContain('## NOME');
    expect(prompt).toContain('Commits: Baixa em lote com conferência | Corrige o fechamento');
    expect(prompt).not.toContain('PedidosTurbo');
  });

  it('o texto local conta e cita os primeiros assuntos', () => {
    const nome = topics.find((t) => t.topic === 'NOME')!;
    expect(localText(nome)).toBe(
      '2 commits: "Baixa em lote com conferência", "Corrige o fechamento". 1 nota alterada: "NOME - Regras de negócio". 1 conversa: "Remessa bancária".',
    );
  });

  it('quando passa de três assuntos, diz quantos ficaram de fora', () => {
    const t = { topic: 'X', commits: ['a', 'b', 'c', 'd', 'e'], notes: [], conversations: [] };
    expect(localText(t)).toBe('5 commits: "a", "b", "c" e mais 2.');
  });
});

describe('parseSummary', () => {
  it('lê o JSON mesmo com cerca de código e texto em volta', () => {
    const raw = 'Claro!\n```json\n{"itens":[{"tema":"nome","texto":"  Baixa em lote\\ncriada. "}]}\n```';
    expect(parseSummary(raw)?.get(topicKey('NOME'))).toBe('Baixa em lote criada.');
  });

  it('resposta que não é o formato esperado vale como falha', () => {
    expect(parseSummary('sem json')).toBeNull();
    expect(parseSummary('{"itens":"x"}')).toBeNull();
    expect(parseSummary('{"itens":[]}')).toBeNull();
    expect(parseSummary('{ quebrado')).toBeNull();
  });

  it('o tema que o Claude esqueceu usa o texto local', () => {
    const topics = buildTopics(sources);
    const items = assembleItems(topics, new Map([[topicKey('NOME'), 'Texto do Claude.']]));
    expect(items.find((i) => i.topic === 'NOME')?.text).toBe('Texto do Claude.');
    expect(items.find((i) => i.topic === 'Watchdog')?.text).toBe('1 nota alterada: "Watchdog - Mapa".');
  });
});
