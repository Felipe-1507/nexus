import fs from 'node:fs';
import path from 'node:path';
import type { DeclaredPlugin, DeclaredServer, ExtensionsList } from '@shared/extensions';

/**
 * Lê, só em leitura, o que o Claude Code tem configurado: servidores MCP do usuário (`~/.claude.json`), do projeto
 * (`.mcp.json`) e locais ao projeto (`~/.claude.json` → `projects`), e os plugins instalados (`~/.claude/plugins`) com o
 * estado de ligado/desligado de `~/.claude/settings.json`. Nada é escrito.
 */

export interface ConfigDeps {
  home: string;
  /** Projetos do Nexus (os únicos cujas configurações o painel olha). */
  projects: { name: string; path: string }[];
  readFile?: (file: string) => string | null;
}

const defaultRead = (file: string): string | null => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Caminhos do Windows aparecem com `/` ou `\`, e a caixa varia: compara sem essas diferenças. */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => path.resolve(p).replace(/\\/g, '/').toLowerCase();
  return norm(a) === norm(b);
}

/** Programa sem pasta nem argumentos, ou endereço sem parâmetros: o que é seguro mostrar. */
export function safeTarget(def: Json): { transport: DeclaredServer['transport']; target: string } {
  const type = typeof def.type === 'string' ? def.type : typeof def.url === 'string' ? 'http' : 'stdio';
  if (type === 'http' || type === 'sse') {
    const raw = typeof def.url === 'string' ? def.url : '';
    try {
      const u = new URL(raw);
      return { transport: type, target: `${u.protocol}//${u.host}${u.pathname === '/' ? '' : u.pathname}` };
    } catch {
      return { transport: type, target: '(endereço inválido)' };
    }
  }
  if (type === 'stdio') {
    const command = typeof def.command === 'string' ? def.command : '';
    const base = command.split(/[\\/]/).pop() ?? command;
    return { transport: 'stdio', target: base };
  }
  return { transport: 'outro', target: type };
}

function serversOf(block: unknown, scope: DeclaredServer['scope'], origin: string): DeclaredServer[] {
  if (!isObject(block)) return [];
  return Object.entries(block)
    .filter(([, def]) => isObject(def))
    .map(([name, def]) => ({ name, scope, origin, ...safeTarget(def as Json) }));
}

export function readDeclaredExtensions(deps: ConfigDeps): ExtensionsList {
  const read = deps.readFile ?? defaultRead;
  const problems: string[] = [];
  const parse = (file: string, label: string): Json | null => {
    const text = read(file);
    if (text === null) return null;
    try {
      const parsed: unknown = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
      return isObject(parsed) ? parsed : null;
    } catch {
      problems.push(`${label} não pôde ser lido (JSON inválido).`);
      return null;
    }
  };

  const servers: DeclaredServer[] = [];
  const claudeJson = parse(path.join(deps.home, '.claude.json'), '~/.claude.json');
  if (claudeJson) {
    servers.push(...serversOf(claudeJson.mcpServers, 'user', ''));
    const byPath = isObject(claudeJson.projects) ? claudeJson.projects : {};
    for (const project of deps.projects) {
      const entry = Object.entries(byPath).find(([p]) => samePath(p, project.path));
      if (entry && isObject(entry[1])) servers.push(...serversOf(entry[1].mcpServers, 'local', project.name));
    }
  }
  for (const project of deps.projects) {
    const mcp = parse(path.join(project.path, '.mcp.json'), `.mcp.json de ${project.name}`);
    if (mcp) servers.push(...serversOf(mcp.mcpServers, 'project', project.name));
  }

  const settings = parse(path.join(deps.home, '.claude', 'settings.json'), '~/.claude/settings.json');
  const enabled = settings && isObject(settings.enabledPlugins) ? settings.enabledPlugins : {};
  const installed = parse(path.join(deps.home, '.claude', 'plugins', 'installed_plugins.json'), 'lista de plugins');
  const plugins: DeclaredPlugin[] = [];
  if (installed && isObject(installed.plugins)) {
    for (const [id, entries] of Object.entries(installed.plugins)) {
      const first = Array.isArray(entries) && isObject(entries[0]) ? entries[0] : null;
      const installPath = first && typeof first.installPath === 'string' ? first.installPath : null;
      const own = installPath ? parse(path.join(installPath, '.mcp.json'), `.mcp.json do plugin ${id}`) : null;
      const names = own ? Object.keys(isObject(own.mcpServers) ? own.mcpServers : own) : [];
      plugins.push({
        id,
        version: first && typeof first.version === 'string' ? first.version : null,
        enabled: enabled[id] === true,
        servers: names,
      });
    }
  }
  plugins.sort((a, b) => a.id.localeCompare(b.id));
  return { servers, plugins, problems };
}
