import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import { ModelCatalogService, toCatalog } from './model-catalog';
import type { AgentQuery, CreateQuery } from './session-manager';

// Formato real devolvido pelo Claude Code 2.1.295 (Etapa 6.1, spikes/claude-sdk/models.mjs).
const MODELS = [
  {
    value: 'default',
    resolvedModel: 'claude-opus-5-5',
    displayName: 'Default (recommended)',
    description: 'Opus 5.5 · Best for everyday, complex tasks',
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    value: 'opus',
    resolvedModel: 'claude-opus-5-5',
    displayName: 'Opus 5.5',
    description: 'For complex work',
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    value: 'haiku',
    resolvedModel: 'claude-haiku-5-5',
    displayName: 'Haiku 5.5',
    description: 'Fastest',
    supportedEffortLevels: ['low', 'high'],
  },
  {
    value: 'claude-haiku-4-5-20251001',
    resolvedModel: 'claude-haiku-4-5-20251001',
    displayName: 'Haiku 4.5',
    description: 'Fastest for quick answers',
  },
] as ModelInfo[];

describe('toCatalog', () => {
  it('separa o padrão, põe os atalhos primeiro e traduz as descrições', () => {
    const catalog = toCatalog(MODELS);
    expect(catalog.defaultModel).toMatchObject({ value: 'default', displayName: 'Opus 5.5' });
    expect(catalog.models.map((m) => [m.value, m.kind])).toEqual([
      ['opus', 'alias'],
      ['haiku', 'alias'],
      ['claude-haiku-4-5-20251001', 'version'],
    ]);
    expect(catalog.models[1]).toMatchObject({
      description: 'O mais rápido, para respostas rápidas',
      efforts: ['low', 'high'],
    });
    expect(catalog.models[2]).toMatchObject({ description: '', efforts: [] });
  });
});

function fakeQuery(models: () => Promise<ModelInfo[]>) {
  const closed = vi.fn();
  const createQuery: CreateQuery = vi.fn(
    () =>
      ({
        supportedModels: models,
        close: closed,
        [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }),
      }) as unknown as AgentQuery,
  );
  return { createQuery, closed };
}

describe('ModelCatalogService', () => {
  it('abre o Claude Code sem mensagem, lê os modelos, fecha e guarda em cache', async () => {
    const fake = fakeQuery(async () => MODELS);
    const service = new ModelCatalogService({
      createQuery: fake.createQuery,
      env: { ANTHROPIC_API_KEY: 'x' },
      cwd: 'C:\\tmp',
    });
    expect((await service.get('C:\\claude.exe')).models).toHaveLength(3);
    await service.get('C:\\claude.exe');
    expect(fake.createQuery).toHaveBeenCalledTimes(1);
    expect(fake.closed).toHaveBeenCalledTimes(1);
    const options = vi.mocked(fake.createQuery).mock.calls[0]![0].options;
    expect(options).toMatchObject({ pathToClaudeCodeExecutable: 'C:\\claude.exe', persistSession: false });
    expect(options.env).toEqual({});

    await service.get('C:\\claude.exe', true);
    expect(fake.createQuery).toHaveBeenCalledTimes(2);
  });

  it('não guarda falhas no cache e sempre fecha o processo', async () => {
    let fail = true;
    const fake = fakeQuery(async () => {
      if (fail) throw new Error('falhou');
      return MODELS;
    });
    const service = new ModelCatalogService({ createQuery: fake.createQuery, env: {}, cwd: 'C:\\tmp' });
    await expect(service.get('C:\\claude.exe')).rejects.toThrow('falhou');
    expect(fake.closed).toHaveBeenCalledTimes(1);
    fail = false;
    expect((await service.get('C:\\claude.exe')).models).toHaveLength(3);
  });
});

describe('aviso de modelo novo', () => {
  const catalog = toCatalog(MODELS as unknown as ModelInfo[]);
  it('no primeiro uso nada é novidade; depois, só o que não estava na lista vista', async () => {
    const { newModels, modelValues } = await import('./model-catalog');
    expect(newModels(catalog, null)).toEqual([]);
    const values = modelValues(catalog);
    expect(newModels(catalog, values)).toEqual([]);
    expect(
      newModels(
        catalog,
        values.filter((v) => v !== 'haiku'),
      ).map((m) => m.value),
    ).toEqual(['haiku']);
  });
});
