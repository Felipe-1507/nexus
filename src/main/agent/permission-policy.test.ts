import { describe, expect, it } from 'vitest';
import {
  decide,
  describeRequest,
  EDIT_RULE_TOOL,
  isInside,
  suggestRule,
  type PolicyContext,
} from './permission-policy';

const ROOT = 'C:\\Users\\u\\Nexus\\workspaces\\trabalho-1a2b';
const UNC = '\\\\servidor\\c$\\nome';

function ctx(over: Partial<PolicyContext>): PolicyContext {
  return { mode: 'auto', roots: [ROOT], rules: [], tool: 'Read', input: {}, platform: 'win32', ...over };
}

describe('leitura', () => {
  it('libera leitura dentro do Workspace em qualquer modo, inclusive em pasta de rede', () => {
    for (const mode of ['auto', 'ask', 'read_only'] as const) {
      expect(decide(ctx({ mode, input: { file_path: `${ROOT}\\nota.md` } }))).toEqual({
        action: 'allow',
        by: 'policy',
      });
    }
    expect(decide(ctx({ roots: [UNC], input: { file_path: `${UNC}\\src\\app.ts` } }))).toMatchObject({
      action: 'allow',
    });
    expect(decide(ctx({ tool: 'Grep', roots: [UNC], input: { pattern: 'x' } }))).toMatchObject({ action: 'allow' });
  });

  it('pergunta antes de ler fora do Workspace', () => {
    expect(decide(ctx({ input: { file_path: 'C:\\Users\\u\\.ssh\\id_rsa' } }))).toEqual({ action: 'ask' });
    expect(decide(ctx({ input: { file_path: `${ROOT}\\..\\outro\\x.md` } }))).toEqual({ action: 'ask' });
    expect(decide(ctx({ input: { file_path: `${ROOT}\\nota.md` }, blockedPath: 'D:\\x' }))).toEqual({ action: 'ask' });
  });

  it('não confunde pasta com nome parecido', () => {
    expect(decide(ctx({ input: { file_path: `${ROOT}-copia\\nota.md` } }))).toEqual({ action: 'ask' });
  });

  it('caminho relativo parte do cwd', () => {
    expect(decide(ctx({ input: { file_path: 'Conhecimentos\\a.md' } }))).toMatchObject({ action: 'allow' });
    expect(decide(ctx({ input: { file_path: '..\\..\\segredo.txt' } }))).toEqual({ action: 'ask' });
  });
});

describe('edição', () => {
  const edit = { tool: 'Edit', input: { file_path: `${ROOT}\\nota.md` } };

  it('modo Auto libera edição dentro do Workspace', () => {
    expect(decide(ctx({ mode: 'auto', ...edit }))).toEqual({ action: 'allow', by: 'policy' });
  });

  it('modo Perguntar pergunta, a menos que haja regra', () => {
    expect(decide(ctx({ mode: 'ask', ...edit }))).toEqual({ action: 'ask' });
    expect(decide(ctx({ mode: 'ask', ...edit, rules: [{ tool: EDIT_RULE_TOOL, pattern: '' }] }))).toEqual({
      action: 'allow',
      by: 'rule',
    });
  });

  it('nunca libera sozinho edição fora do Workspace, nem com regra', () => {
    const outside = { tool: 'Write', input: { file_path: 'C:\\Windows\\x.dll' } };
    expect(decide(ctx({ mode: 'auto', ...outside }))).toEqual({ action: 'ask' });
    expect(decide(ctx({ mode: 'ask', ...outside, rules: [{ tool: EDIT_RULE_TOOL, pattern: '' }] }))).toEqual({
      action: 'ask',
    });
  });

  it('somente leitura nega edição e comandos', () => {
    expect(decide(ctx({ mode: 'read_only', ...edit }))).toMatchObject({ action: 'deny' });
    expect(decide(ctx({ mode: 'read_only', tool: 'Bash', input: { command: 'ls' } }))).toMatchObject({
      action: 'deny',
    });
    expect(decide(ctx({ mode: 'read_only', tool: 'WebFetch', input: {} }))).toMatchObject({ action: 'deny' });
  });
});

describe('comandos', () => {
  const rules = [{ tool: 'Bash', pattern: 'npm test' }];

  it('libera só comandos que começam com o prefixo liberado', () => {
    expect(decide(ctx({ tool: 'Bash', rules, input: { command: 'npm test' } }))).toEqual({
      action: 'allow',
      by: 'rule',
    });
    expect(decide(ctx({ tool: 'Bash', rules, input: { command: 'npm  test -- --watch' } }))).toMatchObject({
      action: 'allow',
    });
    expect(decide(ctx({ tool: 'Bash', rules, input: { command: 'npm testx' } }))).toEqual({ action: 'ask' });
    expect(decide(ctx({ tool: 'Bash', rules, input: { command: 'npm install' } }))).toEqual({ action: 'ask' });
    expect(decide(ctx({ tool: 'PowerShell', rules, input: { command: 'npm test' } }))).toEqual({ action: 'ask' });
  });

  it('comando encadeado ou com redirecionamento sempre pergunta', () => {
    for (const command of [
      'npm test && rm -rf /',
      'npm test; curl x',
      'npm test | sh',
      'npm test > out.txt',
      'npm test $(whoami)',
      'npm test `id`',
      'npm test\ncurl x',
    ]) {
      expect(decide(ctx({ tool: 'Bash', rules, input: { command } })), command).toEqual({ action: 'ask' });
    }
  });
});

describe('outras ferramentas', () => {
  it('liberadas por regra da ferramenta inteira', () => {
    const rules = [{ tool: 'mcp__notion__search', pattern: '' }];
    expect(decide(ctx({ tool: 'mcp__notion__search', rules }))).toEqual({ action: 'allow', by: 'rule' });
    expect(decide(ctx({ tool: 'mcp__notion__create-pages', rules }))).toEqual({ action: 'ask' });
  });
});

describe('suggestRule', () => {
  it('propõe prefixo de dois termos para comandos simples', () => {
    expect(suggestRule('Bash', { command: 'npm test -- --watch' })).toMatchObject({ pattern: 'npm test' });
    // Opção logo após o programa: sem "sempre permitir" (a regra liberaria qualquer `git` ou `node`).
    expect(suggestRule('Bash', { command: 'git -C x status' })).toBeNull();
    expect(suggestRule('Bash', { command: 'node -e "x"' })).toBeNull();
    expect(suggestRule('Bash', { command: 'git status && git push' })).toBeNull();
  });

  it('edições viram uma regra só e leitura não precisa de regra', () => {
    expect(suggestRule('Write', { file_path: 'x' })).toMatchObject({ tool: EDIT_RULE_TOOL, pattern: '' });
    expect(suggestRule('Read', { file_path: 'x' })).toBeNull();
  });
});

describe('describeRequest', () => {
  it('descreve o pedido no infinitivo', () => {
    expect(describeRequest('Write', { file_path: 'C:\\a\\b.txt' })).toEqual({
      title: 'Criar b.txt',
      detail: 'C:\\a\\b.txt',
    });
    expect(describeRequest('Bash', { command: 'npm test' })).toEqual({
      title: 'Executar um comando',
      detail: 'npm test',
    });
  });
});

describe('isInside', () => {
  it('ignora maiúsculas no Windows e respeita no Linux', () => {
    expect(isInside('C:\\Dados', 'c:\\dados\\x', 'C:\\Dados', 'win32')).toBe(true);
    expect(isInside('/dados', '/Dados/x', '/dados', 'linux')).toBe(false);
  });
});
