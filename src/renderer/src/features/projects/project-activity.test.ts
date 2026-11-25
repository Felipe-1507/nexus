import { describe, expect, it } from 'vitest';
import { GENERAL, projectActivity } from './project-activity';

const projectOf = new Map<string, string | null>([
  ['c1', 'nome'],
  ['c2', 'nome'],
  ['c3', 'turbo'],
  ['c4', null],
]);

describe('sinal dos projetos', () => {
  it('aprovação vence trabalhando, que vence resposta pronta; conversas gerais vão para "Geral"', () => {
    const out = projectActivity(projectOf, { c1: {}, c4: {} }, { c2: [{}] }, { c3: true, c1: true });
    expect(out).toEqual({ nome: 'approval', turbo: 'done', [GENERAL]: 'working' });
  });

  it('nada acontecendo: nenhum sinal; conversa desconhecida é ignorada', () => {
    expect(projectActivity(projectOf, {}, { c1: [] }, {})).toEqual({});
    expect(projectActivity(projectOf, { outra: {} }, {}, {})).toEqual({});
  });
});
