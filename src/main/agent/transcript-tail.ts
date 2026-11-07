import fs from 'node:fs';
import path from 'node:path';

/** Contexto da última chamada à API de uma sessão, lido do arquivo de transcrição do Claude Code. */
export interface TranscriptContext {
  model: string;
  input: number;
  cacheRead: number;
  cacheCreation: number;
  /** Fim da chamada (carimbo da linha). */
  at: string;
}

export type TranscriptTail =
  | { kind: 'usage'; usage: TranscriptContext }
  /** A última coisa registrada foi uma compactação: o contexto atual ainda não foi medido. */
  | { kind: 'after-compaction'; at: string | null; preTokens: number | null; postTokens: number | null };

/**
 * Procura, do fim para o começo, a última chamada à API com uso registrado. Linhas de subagentes e respostas
 * sintéticas (erros da API) não contam. Se uma compactação veio depois da última chamada, o contexto é outro e o
 * resultado diz isso em vez de repetir um número antigo.
 */
export function parseTranscriptTail(text: string): TranscriptTail | null {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (!line) continue;
    const isBoundary = line.includes('"compact_boundary"');
    const isAssistant = line.includes('"type":"assistant"') && line.includes('"usage"');
    if (!isBoundary && !isAssistant) continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue; // linha cortada
    }
    if (isBoundary && o.type === 'system' && o.subtype === 'compact_boundary') {
      const meta = (o.compactMetadata ?? o.compact_metadata) as Record<string, unknown> | undefined;
      const num = (v: unknown) => (typeof v === 'number' ? v : null);
      return {
        kind: 'after-compaction',
        at: typeof o.timestamp === 'string' ? o.timestamp : null,
        preTokens: num(meta?.preTokens ?? meta?.pre_tokens),
        postTokens: num(meta?.postTokens ?? meta?.post_tokens),
      };
    }
    if (o.type !== 'assistant' || o.isSidechain === true) continue;
    const message = o.message as { model?: unknown; usage?: Record<string, unknown> } | undefined;
    const usage = message?.usage;
    const model = message?.model;
    if (!usage || typeof model !== 'string' || model === '<synthetic>' || typeof o.timestamp !== 'string') continue;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    return {
      kind: 'usage',
      usage: {
        model,
        input: n(usage.input_tokens),
        cacheRead: n(usage.cache_read_input_tokens),
        cacheCreation: n(usage.cache_creation_input_tokens),
        at: o.timestamp,
      },
    };
  }
  return null;
}

const START_BYTES = 2 * 1024 * 1024;
const MAX_BYTES = 32 * 1024 * 1024;

/**
 * Lê só o fim do arquivo (transcrições passam de 100 MB), ampliando a janela até achar uma chamada com uso.
 * Assíncrona de propósito: roda no processo principal, e uma leitura síncrona congelaria a janela inteira se o disco
 * (ou o antivírus examinando um arquivo grande que acabou de mudar) demorasse.
 */
export async function readTranscriptTail(file: string): Promise<TranscriptTail | null> {
  const handle = await fs.promises.open(file, 'r');
  try {
    const { size } = await handle.stat();
    for (let bytes = START_BYTES; ; bytes *= 4) {
      const length = Math.min(size, bytes);
      const start = size - length;
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, start);
      let text = buffer.toString('utf8', 0, bytesRead);
      // O começo da janela pode cair no meio de uma linha: descarta o pedaço.
      if (start > 0) text = text.slice(text.indexOf('\n') + 1);
      const found = parseTranscriptTail(text);
      if (found || start === 0 || bytes >= MAX_BYTES) return found;
    }
  } finally {
    await handle.close();
  }
}

/** O Claude Code nomeia a pasta da sessão trocando tudo que não é letra ou número do caminho por `-`. */
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

/** Arquivo de transcrição de uma sessão, ou `null` se não for encontrado (nada é presumido). */
export function findTranscript(
  sessionId: string,
  cwd: string,
  opts: { home: string; env: NodeJS.ProcessEnv },
): { file: string; mtimeMs: number } | null {
  const base = opts.env.CLAUDE_CONFIG_DIR || path.join(opts.home, '.claude');
  const projects = path.join(base, 'projects');
  const name = `${sessionId}.jsonl`;
  const stat = (file: string) => {
    try {
      const s = fs.statSync(file);
      return s.isFile() ? { file, mtimeMs: s.mtimeMs } : null;
    } catch {
      return null;
    }
  };
  const direct = stat(path.join(projects, encodeProjectDir(cwd), name));
  if (direct) return direct;
  // Caminhos muito longos recebem outro nome de pasta: procura a sessão nas pastas de projetos.
  try {
    for (const dir of fs.readdirSync(projects)) {
      const found = stat(path.join(projects, dir, name));
      if (found) return found;
    }
  } catch {
    // pasta de projetos inexistente
  }
  return null;
}
