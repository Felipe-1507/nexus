import path from 'node:path';
import type { PermissionMode } from '@shared/permissions';
import { isInside } from '../fs/safe-path';

export { isInside };

export interface RuleLike {
  tool: string;
  pattern: string;
}

export type PolicyDecision =
  { action: 'allow'; by: 'policy' | 'rule' } | { action: 'deny'; reason: string } | { action: 'ask' };

export interface PolicyContext {
  mode: PermissionMode;
  /** Pastas de trabalho da sessão. A primeira é o cwd (base dos caminhos relativos). */
  roots: string[];
  rules: RuleLike[];
  tool: string;
  input: Record<string, unknown>;
  /** Caminho fora das pastas permitidas que motivou o pedido, quando o Claude Code informa. */
  blockedPath?: string;
  platform?: NodeJS.Platform;
}

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead']);
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
/** Regra única que cobre todas as ferramentas de edição de arquivos. */
export const EDIT_RULE_TOOL = 'edit';

/** Encadeamento ou redirecionamento: um comando assim nunca é liberado por regra. */
const SHELL_COMPOSITION = /[;&|`<>\r\n]|\$\(/;

/**
 * Decide um pedido de permissão do Claude Code antes de incomodar o usuário. Só libera sozinho o que é
 * previsível: leitura (e, no modo Auto, edição) dentro das pastas do Workspace, e o que o usuário já liberou
 * por regra. Todo o resto vira pergunta (ou negação, no modo somente leitura).
 *
 * Em pastas de rede o Claude Code pede permissão até para ler dentro do próprio cwd (Etapa 0, achado H); esta
 * política é o que evita perguntas a cada leitura.
 */
export function decide(ctx: PolicyContext): PolicyDecision {
  const platform = ctx.platform ?? process.platform;
  const inside = (p: string) => ctx.roots.some((root) => isInside(root, p, ctx.roots[0]!, platform));
  const paths = targetPaths(ctx.tool, ctx.input);
  const allInside = paths.every(inside) && (!ctx.blockedPath || inside(ctx.blockedPath));

  if (READ_TOOLS.has(ctx.tool)) {
    return allInside ? { action: 'allow', by: 'policy' } : { action: 'ask' };
  }
  if (ctx.mode === 'read_only') {
    return { action: 'deny', reason: 'Este Workspace está em modo somente leitura.' };
  }
  if (WRITE_TOOLS.has(ctx.tool)) {
    if (!allInside || paths.length === 0) return { action: 'ask' };
    if (ctx.mode === 'auto') return { action: 'allow', by: 'policy' };
    return ctx.rules.some((r) => r.tool === EDIT_RULE_TOOL) ? { action: 'allow', by: 'rule' } : { action: 'ask' };
  }
  if (SHELL_TOOLS.has(ctx.tool)) {
    // O encadeamento é verificado no texto original: a normalização de espaços apagaria quebras de linha.
    if (isComposite(ctx.input.command)) return { action: 'ask' };
    const command = normalizeCommand(ctx.input.command);
    if (!command) return { action: 'ask' };
    const allowed = ctx.rules.some(
      (r) => r.tool === ctx.tool && r.pattern && (command === r.pattern || command.startsWith(`${r.pattern} `)),
    );
    return allowed ? { action: 'allow', by: 'rule' } : { action: 'ask' };
  }
  return ctx.rules.some((r) => r.tool === ctx.tool && r.pattern === '')
    ? { action: 'allow', by: 'rule' }
    : { action: 'ask' };
}

/** Regra que o botão "Sempre permitir" criaria para este pedido (ou null quando não faz sentido). */
export function suggestRule(tool: string, input: Record<string, unknown>): (RuleLike & { label: string }) | null {
  if (READ_TOOLS.has(tool)) return null;
  if (WRITE_TOOLS.has(tool)) {
    return { tool: EDIT_RULE_TOOL, pattern: '', label: 'Sempre permitir edições de arquivos neste Workspace' };
  }
  if (SHELL_TOOLS.has(tool)) {
    if (isComposite(input.command)) return null;
    const command = normalizeCommand(input.command);
    if (!command) return null;
    const tokens = command.split(' ');
    const pattern = tokens.length > 1 && !tokens[1]!.startsWith('-') ? `${tokens[0]} ${tokens[1]}` : tokens[0]!;
    return { tool, pattern, label: `Sempre permitir "${pattern}" neste Workspace` };
  }
  return { tool, pattern: '', label: 'Sempre permitir neste Workspace' };
}

/** Descrição de uma regra para a lista do Workspace. */
export function describeRule(rule: RuleLike): string {
  if (rule.tool === EDIT_RULE_TOOL) return 'Editar arquivos dentro do Workspace';
  if (SHELL_TOOLS.has(rule.tool)) return `Comandos que começam com "${rule.pattern}"`;
  const mcp = /^mcp__(.+?)__(.+)$/.exec(rule.tool);
  return mcp ? `${mcp[2]} (${mcp[1]})` : rule.tool;
}

/** O que o Claude quer fazer, no infinitivo, para o cartão de aprovação. */
export function describeRequest(tool: string, input: Record<string, unknown>): { title: string; detail?: string } {
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  const file = str(input.file_path) ?? str(input.notebook_path);
  const base = file ? path.basename(file) : 'um arquivo';
  switch (tool) {
    case 'Read':
      return { title: `Ler ${base}`, detail: file };
    case 'Write':
      return { title: `Criar ${base}`, detail: file };
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return { title: `Editar ${base}`, detail: file };
    case 'Glob':
    case 'Grep':
      return { title: 'Procurar arquivos', detail: str(input.path) ?? str(input.pattern) };
    case 'Bash':
    case 'PowerShell':
      return { title: 'Executar um comando', detail: str(input.command) };
    case 'WebFetch':
      return { title: 'Abrir uma página da web', detail: str(input.url) };
    case 'WebSearch':
      return { title: 'Pesquisar na web', detail: str(input.query) };
    default: {
      const mcp = /^mcp__(.+?)__(.+)$/.exec(tool);
      return { title: mcp ? `Usar ${mcp[2]} (${mcp[1]})` : `Usar ${tool}` };
    }
  }
}

function isComposite(value: unknown): boolean {
  return typeof value === 'string' && SHELL_COMPOSITION.test(value);
}

function normalizeCommand(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function targetPaths(tool: string, input: Record<string, unknown>): string[] {
  const keys = tool === 'Grep' || tool === 'Glob' || tool === 'LS' ? ['path'] : ['file_path', 'notebook_path'];
  return keys.map((k) => input[k]).filter((v): v is string => typeof v === 'string' && v.length > 0);
}
