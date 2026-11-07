import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/** Arquivos de configuração do Claude Code dentro da pasta do projeto. */
const CONFIG_FILES = [path.join('.claude', 'settings.json'), path.join('.claude', 'settings.local.json'), '.mcp.json'];

export interface ProjectConfigInspection {
  /** O que essas configurações fazem, em pt-BR. Vazio = nada que execute código ou mude permissões. */
  risks: string[];
  /** Hash do conteúdo dos arquivos encontrados (null = nenhum arquivo). */
  fingerprint: string | null;
}

/**
 * Examina as configurações do Claude Code de uma pasta antes de carregá-las. Em modo não interativo o Claude Code
 * não mostra o diálogo de confiança (ADR 0003): hooks, `apiKeyHelper`, `statusLine` e servidores MCP executam
 * programas sozinhos, e regras de permissão do projeto liberariam ferramentas sem passar pelo Nexus.
 */
export async function inspectProjectConfig(dir: string): Promise<ProjectConfigInspection> {
  const risks: string[] = [];
  const hash = createHash('sha256');
  let found = false;

  for (const rel of CONFIG_FILES) {
    let text: string;
    try {
      text = await fs.readFile(path.join(dir, rel), 'utf8');
    } catch {
      continue;
    }
    found = true;
    hash.update(`${rel}\n${text}\n`);
    if (rel === '.mcp.json') {
      risks.push('Servidores MCP do projeto (.mcp.json), que iniciam programas');
      continue;
    }
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      risks.push(`${rel} não pôde ser lido (JSON inválido)`);
      continue;
    }
    if (json.hooks && Object.keys(json.hooks as object).length > 0)
      risks.push(`Hooks em ${rel}, que executam comandos`);
    if (json.apiKeyHelper) risks.push(`apiKeyHelper em ${rel}, que executa um comando`);
    if (json.statusLine) risks.push(`statusLine em ${rel}, que executa um comando`);
    if (json.mcpServers || json.enableAllProjectMcpServers || json.enabledMcpjsonServers) {
      risks.push(`Servidores MCP habilitados em ${rel}`);
    }
    const allow = (json.permissions as { allow?: unknown[] } | undefined)?.allow;
    if (Array.isArray(allow) && allow.length > 0) {
      risks.push(`${allow.length} regra(s) de permissão liberadas em ${rel}`);
    }
    if (json.env && Object.keys(json.env as object).length > 0) risks.push(`Variáveis de ambiente definidas em ${rel}`);
  }

  return { risks, fingerprint: found ? hash.digest('hex') : null };
}
