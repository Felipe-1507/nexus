import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk';
import { effortSchema, type ModelCatalog, type ModelOption } from '@shared/models';
import { AsyncQueue } from './async-queue';
import { childEnv } from './child-env';
import type { CreateQuery } from './session-manager';

/** Descrições em pt-BR para os atalhos; versões fixas mostram só o nome. */
const ALIAS_DESCRIPTIONS: Record<string, string> = {
  opus: 'Para trabalho complexo e o dia a dia',
  sonnet: 'Mais eficiente para tarefas simples',
  fable: 'Para os desafios mais difíceis e longos',
  haiku: 'O mais rápido, para respostas rápidas',
};

const TIMEOUT_MS = 30_000;

/** Converte a lista do Claude Code no catálogo do Nexus (atalhos primeiro, "default" à parte). */
export function toCatalog(models: ModelInfo[]): ModelCatalog {
  const toOption = (m: ModelInfo): ModelOption => {
    const alias = !m.value.startsWith('claude-');
    return {
      value: m.value,
      displayName: m.displayName,
      description: alias ? (ALIAS_DESCRIPTIONS[m.value] ?? m.description) : '',
      resolvedModel: m.resolvedModel ?? null,
      efforts: (m.supportedEffortLevels ?? []).filter((e) => effortSchema.safeParse(e).success),
      kind: alias ? 'alias' : 'version',
    };
  };
  const def = models.find((m) => m.value === 'default');
  const rest = models.filter((m) => m.value !== 'default').map(toOption);
  const defaultTarget = def && rest.find((m) => m.resolvedModel === def.resolvedModel && m.kind === 'alias');
  return {
    defaultModel: def
      ? {
          ...toOption(def),
          displayName: defaultTarget?.displayName ?? def.displayName,
          description: 'Padrão do Claude Code',
        }
      : null,
    models: [...rest.filter((m) => m.kind === 'alias'), ...rest.filter((m) => m.kind === 'version')],
  };
}

/**
 * Modelos disponíveis para a conta conectada. Abre um processo do Claude Code sem mandar mensagem (não consome
 * tokens), pergunta a lista e fecha. O resultado fica em cache até o usuário pedir para atualizar.
 */
export class ModelCatalogService {
  private cache: { cliPath: string; catalog: Promise<ModelCatalog> } | null = null;

  constructor(private readonly deps: { createQuery: CreateQuery; env: NodeJS.ProcessEnv; cwd: string }) {}

  get(cliPath: string, refresh = false): Promise<ModelCatalog> {
    if (!refresh && this.cache?.cliPath === cliPath) return this.cache.catalog;
    const catalog = this.fetch(cliPath);
    this.cache = { cliPath, catalog };
    catalog.catch(() => {
      if (this.cache?.catalog === catalog) this.cache = null;
    });
    return catalog;
  }

  private async fetch(cliPath: string): Promise<ModelCatalog> {
    const input = new AsyncQueue<never>();
    const query = this.deps.createQuery({
      prompt: input,
      options: {
        pathToClaudeCodeExecutable: cliPath,
        env: childEnv(this.deps.env),
        cwd: this.deps.cwd,
        persistSession: false,
      },
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const models = await Promise.race([
        query.supportedModels(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('O Claude Code não informou os modelos a tempo.')), TIMEOUT_MS);
        }),
      ]);
      return toCatalog(models);
    } finally {
      clearTimeout(timer);
      input.close();
      query.close();
    }
  }
}

/** Modelos do catálogo que o usuário ainda não viu. Sem lista anterior (primeiro uso), nada é novidade. */
export function newModels(catalog: ModelCatalog, seen: string[] | null): ModelOption[] {
  if (seen === null) return [];
  const known = new Set(seen);
  return catalog.models.filter((m) => !known.has(m.value));
}

/** Valores de todos os modelos do catálogo (o que fica gravado como "já visto"). */
export function modelValues(catalog: ModelCatalog): string[] {
  return catalog.models.map((m) => m.value);
}
