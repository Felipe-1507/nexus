import { describe, expect, it } from 'vitest';
import { composeSystemPrompt, summarizeInstructions } from './context-composer';

const base = { globalInstructions: '', workspaceName: 'Trabalho', workspaceInstructions: '- Valores em BRL\n' };

describe('composeSystemPrompt', () => {
  it('inclui as regras do Nexus e as instruções do Workspace', () => {
    const prompt = composeSystemPrompt({ ...base, capabilities: 'read-only' });
    expect(prompt).toContain('Workspace "Trabalho"');
    expect(prompt).toContain('Trabalhe em silêncio');
    expect(prompt).toContain('modo somente leitura');
    expect(prompt).not.toContain('Você pode criar e editar');
    expect(prompt.endsWith('- Valores em BRL')).toBe(true);
    expect(prompt).not.toContain('Instruções gerais');
  });

  it('com edição liberada, orienta a não contornar negações', () => {
    const prompt = composeSystemPrompt({ ...base, workspaceInstructions: '', capabilities: 'full' });
    expect(prompt).not.toContain('somente leitura');
    expect(prompt).toContain('Você pode criar e editar arquivos');
    expect(prompt).toContain('não tente contorná-la');
    expect(prompt).toContain('(nenhuma instrução definida)');
  });

  it('camadas na ordem: gerais → Workspace → projeto', () => {
    const prompt = composeSystemPrompt({
      ...base,
      globalInstructions: 'Trabalho com planilhas.',
      project: {
        name: 'NOME',
        path: '\\\\srv\\nome',
        instructions: 'API em Node.',
        knowledgeDir: 'C:\\ws\\Conhecimentos',
      },
      capabilities: 'full',
    });
    const order = ['Instruções gerais do usuário', 'Instruções do Workspace', 'Projeto "NOME"'].map((s) =>
      prompt.indexOf(s),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(prompt).toContain('\\\\srv\\nome');
    expect(prompt).toContain('C:\\ws\\Conhecimentos');
    expect(prompt.endsWith('API em Node.')).toBe(true);
  });
});

describe('lista de projetos na conversa geral', () => {
  const projects = [
    { name: 'NOME', path: '\\\\servidor\\c$\\nome', summary: 'API de pedidos', available: true },
    { name: 'pedidos_turbo', path: 'C:\\dev\\pt', summary: '', available: false },
  ];

  it('o Geral recebe os projetos, com pasta, resumo e aviso de pasta inacessível', () => {
    const prompt = composeSystemPrompt({ ...base, capabilities: 'full', projects });
    expect(prompt).toContain('## Projetos deste Workspace');
    expect(prompt).toContain('- NOME — pasta: \\\\servidor\\c$\\nome — API de pedidos');
    expect(prompt).toContain('- pedidos_turbo — pasta: C:\\dev\\pt (pasta inacessível agora)');
    expect(prompt).toContain('Mapa dos sistemas');
  });

  it('em somente leitura, não pede para criar notas', () => {
    const prompt = composeSystemPrompt({ ...base, capabilities: 'read-only', projects });
    expect(prompt).toContain('## Projetos deste Workspace');
    expect(prompt).not.toContain('Mapa dos sistemas');
  });

  it('conversa de projeto e Workspace sem projetos não ganham a seção', () => {
    const project = { name: 'NOME', path: 'C:\\p', instructions: '', knowledgeDir: 'C:\\k' };
    expect(composeSystemPrompt({ ...base, capabilities: 'full', projects, project })).not.toContain(
      'Projetos deste Workspace',
    );
    expect(composeSystemPrompt({ ...base, capabilities: 'full', projects: [] })).not.toContain(
      'Projetos deste Workspace',
    );
  });

  it('limita a lista e resume as instruções na primeira linha útil', () => {
    const many = Array.from({ length: 45 }, (_, i) => ({
      name: `P${i}`,
      path: `C:\\p${i}`,
      summary: '',
      available: true,
    }));
    const prompt = composeSystemPrompt({ ...base, capabilities: 'full', projects: many });
    expect(prompt).toContain('- P39 —');
    expect(prompt).not.toContain('- P40 —');
    expect(prompt).toContain('(+5 projetos fora desta lista)');
    expect(summarizeInstructions('\n# API de pedidos da organização\nresto')).toBe('API de pedidos da organização');
    expect(summarizeInstructions('   ')).toBe('');
    expect(summarizeInstructions('x'.repeat(300))).toHaveLength(160);
  });
});
