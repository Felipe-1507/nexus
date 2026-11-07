import path from 'node:path';
import { z } from 'zod';
import { CLAUDE_CLI_TESTED_MIN, type ClaudeAuth, type ClaudeCli, type ClaudeStatus } from '@shared/claude';
import type { Run } from '../platform/run';
import { childEnv } from './child-env';

export interface DetectorDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  homedir: string;
  run: Run;
  exists: (file: string) => boolean;
  readText: (file: string) => string;
  /** Caminho fixo (testes e, no futuro, configuração manual). Se informado, a busca automática não roda. */
  overridePath?: string;
  now?: () => string;
}

type Located = { path: string; source: Extract<ClaudeCli, { state: 'found' }>['source'] };

const VERSION_TIMEOUT_MS = 15_000;
const AUTH_TIMEOUT_MS = 20_000;

/** Encontra o executável real do Claude Code. No Windows o npm instala um atalho .cmd que aponta para o .exe. */
export async function locateCli(deps: DetectorDeps): Promise<Located | null> {
  if (deps.overridePath) return deps.exists(deps.overridePath) ? { path: deps.overridePath, source: 'override' } : null;

  const win = deps.platform === 'win32';
  const candidates: Located[] = [];

  const where = await deps.run(win ? 'where' : 'which', win ? ['claude'] : ['-a', 'claude'], {
    timeoutMs: 5_000,
    env: deps.env,
  });
  if (where.ok) {
    for (const line of where.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)) {
      if (!win || line.toLowerCase().endsWith('.exe')) candidates.push({ path: line, source: 'path' });
      else if (line.toLowerCase().endsWith('.cmd')) {
        const target = resolveNpmShim(line, deps.readText);
        if (target) candidates.push({ path: target, source: 'path' });
      }
    }
  }

  const exe = win ? 'claude.exe' : 'claude';
  candidates.push({ path: path.join(deps.homedir, '.local', 'bin', exe), source: 'native' });
  if (win && deps.env.APPDATA) {
    candidates.push({
      path: path.join(deps.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', exe),
      source: 'npm',
    });
  }

  return candidates.find((c) => deps.exists(c.path)) ?? null;
}

/** Lê o atalho `claude.cmd` do npm e devolve o .exe para o qual ele aponta. */
export function resolveNpmShim(cmdPath: string, readText: (file: string) => string): string | null {
  try {
    const match = /"%dp0%\\([^"]+?\.exe)"/i.exec(readText(cmdPath));
    return match ? path.join(path.dirname(cmdPath), match[1]!) : null;
  } catch {
    return null;
  }
}

const authStatusSchema = z.object({
  loggedIn: z.boolean(),
  authMethod: z.string().nullish(),
  apiProvider: z.string().nullish(),
  email: z.string().nullish(),
  orgName: z.string().nullish(),
  subscriptionType: z.string().nullish(),
});

export function parseVersion(output: string): string | null {
  return /(\d+\.\d+\.\d+)/.exec(output)?.[1] ?? null;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

export function parseAuthStatus(output: string): ClaudeAuth {
  let json: unknown;
  try {
    json = JSON.parse(output);
  } catch {
    return { state: 'unknown', message: 'Resposta inesperada de "claude auth status".' };
  }
  const parsed = authStatusSchema.safeParse(json);
  if (!parsed.success) return { state: 'unknown', message: 'Resposta inesperada de "claude auth status".' };
  const a = parsed.data;
  if (!a.loggedIn) return { state: 'logged_out' };
  return {
    state: 'logged_in',
    method: a.authMethod ?? null,
    provider: a.apiProvider ?? null,
    email: a.email ?? null,
    organization: a.orgName ?? null,
    plan: a.subscriptionType ?? null,
  };
}

/** Diagnóstico completo: onde está o CLI, qual versão, e se há uma conta conectada. Não consome tokens. */
export async function detectClaude(deps: DetectorDeps): Promise<ClaudeStatus> {
  const checkedAt = (deps.now ?? (() => new Date().toISOString()))();
  const warnings: string[] = [];
  if (deps.env.ANTHROPIC_API_KEY) {
    warnings.push(
      'A variável ANTHROPIC_API_KEY está definida no Windows. O Nexus a ignora e usa o login do Claude Code; remova-a se não for usada.',
    );
  }

  const located = await locateCli(deps);
  if (!located) {
    return {
      checkedAt,
      cli: { state: 'not_found' },
      auth: { state: 'unknown', message: 'Claude Code não encontrado.' },
      warnings,
      ready: false,
    };
  }

  const env = childEnv(deps.env);
  const versionRun = await deps.run(located.path, ['--version'], { timeoutMs: VERSION_TIMEOUT_MS, env });
  const version = versionRun.ok ? parseVersion(versionRun.stdout) : null;
  if (!version) {
    const message = versionRun.ok
      ? 'Não foi possível ler a versão.'
      : versionRun.reason === 'timeout'
        ? 'O Claude Code não respondeu a tempo.'
        : `O Claude Code não executou (${versionRun.stderr.trim() || `código ${versionRun.code ?? '?'}`}).`;
    return {
      checkedAt,
      cli: { state: 'error', path: located.path, message },
      auth: { state: 'unknown', message: 'Não verificado.' },
      warnings,
      ready: false,
    };
  }
  if (compareVersions(version, CLAUDE_CLI_TESTED_MIN) < 0) {
    warnings.push(
      `Claude Code ${version} é anterior à versão testada (${CLAUDE_CLI_TESTED_MIN}). Rode "claude update".`,
    );
  }

  // Com conta desconectada o comando pode sair com código diferente de zero, mas ainda imprime o JSON.
  const authRun = await deps.run(located.path, ['auth', 'status', '--json'], { timeoutMs: AUTH_TIMEOUT_MS, env });
  const auth: ClaudeAuth =
    !authRun.ok && authRun.reason === 'timeout'
      ? { state: 'unknown', message: 'A verificação da conta não respondeu a tempo.' }
      : parseAuthStatus(authRun.stdout.trim());

  return {
    checkedAt,
    cli: { state: 'found', path: located.path, version, source: located.source },
    auth,
    warnings,
    ready: auth.state === 'logged_in',
  };
}
