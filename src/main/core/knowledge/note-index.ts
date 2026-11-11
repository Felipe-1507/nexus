import path from 'node:path';
import type { GalaxyGraph, NoteLinks } from '@shared/knowledge';
import { parseNote } from './markdown';
import type { Vault } from './vault';

export interface NoteMeta {
  path: string;
  title: string;
  summary: string;
  tags: string[];
  /** Destinos dos `[[links]]`, como escritos. */
  links: string[];
  aliases: string[];
  mtimeMs: number;
  /** Tamanho do conteúdo em caracteres. */
  chars: number;
}

const stem = (p: string) => p.replace(/\.md$/i, '').toLowerCase();

/** Índice do vault: títulos, resumos, links e backlinks. Base do índice que vai ao Claude e da galáxia. */
export class NoteIndex {
  private readonly byPath = new Map<string, NoteMeta>();
  /**
   * Finais do caminho sem `.md`, em minúsculas (`a/b/c`, `b/c`, `c`) → notas; e aliases → notas. Evitam varrer o
   * vault inteiro a cada link, o que pesava em vaults com milhares de notas.
   */
  private readonly bySuffix = new Map<string, NoteMeta[]>();
  private readonly byAlias = new Map<string, NoteMeta[]>();

  constructor(readonly notes: NoteMeta[]) {
    const add = (map: Map<string, NoteMeta[]>, key: string, n: NoteMeta) => {
      const list = map.get(key);
      if (!list) map.set(key, [n]);
      else if (!list.includes(n)) list.push(n);
    };
    for (const n of notes) {
      this.byPath.set(n.path, n);
      const parts = stem(n.path).split('/');
      for (let i = 0; i < parts.length; i++) add(this.bySuffix, parts.slice(i).join('/'), n);
      for (const a of n.aliases) add(this.byAlias, a.toLowerCase(), n);
    }
  }

  get(p: string): NoteMeta | undefined {
    return this.byPath.get(p);
  }

  /**
   * Resolve `[[alvo]]` como o Obsidian: caminho parcial (`Pasta/Nota`) ou só o nome (ignorando maiúsculas), também
   * pelos `aliases`. Com vários candidatos, prefere a mesma pasta de quem cita e depois o caminho mais curto.
   */
  resolve(target: string, fromPath?: string): string | null {
    const t = stem(target.trim());
    if (!t) return null;
    const candidates = [...(this.bySuffix.get(t) ?? [])];
    if (!t.includes('/')) for (const n of this.byAlias.get(t) ?? []) if (!candidates.includes(n)) candidates.push(n);
    if (candidates.length === 0) return null;
    const fromDir = fromPath ? path.posix.dirname(fromPath) : null;
    candidates.sort(
      (a, b) =>
        Number(path.posix.dirname(b.path) === fromDir) - Number(path.posix.dirname(a.path) === fromDir) ||
        a.path.length - b.path.length,
    );
    return candidates[0]!.path;
  }

  links(p: string): NoteLinks {
    const note = this.byPath.get(p);
    const outgoing = (note?.links ?? []).map((target) => ({ target, path: this.resolve(target, p) }));
    const backlinks = this.notes
      .filter((n) => n.path !== p && n.links.some((t) => this.resolve(t, n.path) === p))
      .map((n) => ({ path: n.path, title: n.title }));
    return { outgoing, backlinks };
  }

  /** Grafo para a galáxia: cada par de notas ligadas aparece uma vez, venha o link de um lado ou dos dois. */
  graph(): GalaxyGraph {
    const position = new Map(this.notes.map((n, i) => [n.path, i]));
    const degree = new Array<number>(this.notes.length).fill(0);
    const seen = new Set<string>();
    const links: Array<[number, number]> = [];
    this.notes.forEach((n, i) => {
      for (const target of n.links) {
        const resolved = this.resolve(target, n.path);
        const j = resolved === null ? undefined : position.get(resolved);
        if (j === undefined || j === i) continue;
        const pair: [number, number] = i < j ? [i, j] : [j, i];
        const key = `${pair[0]}:${pair[1]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        links.push(pair);
        degree[i]!++;
        degree[j]!++;
      }
    });
    const notes = this.notes.map((n, i) => ({
      path: n.path,
      title: n.title,
      system: n.path.includes('/') ? n.path.slice(0, n.path.indexOf('/')) : '',
      tags: n.tags,
      mtimeMs: n.mtimeMs,
      chars: n.chars,
      degree: degree[i]!,
    }));
    return { notes, links };
  }

  /**
   * Linhas do índice para o prompt do Claude, até o limite de caracteres. Curto de propósito: o Claude abre a nota
   * que precisar. Cabendo tudo, vão todas (das mais recentes para as mais antigas). Se não couber, ficam as mais
   * ligadas às outras (mapas e notas centrais) e, entre iguais, as mais recentes, em vez de só as mexidas por último.
   */
  promptLines(budget = 6000): { lines: string[]; omitted: number } {
    const line = (n: NoteMeta) => {
      const tags = n.tags.length ? ` [${n.tags.map((t) => `#${t}`).join(' ')}]` : '';
      return `- ${n.path} — ${n.title}${n.summary ? `: ${n.summary}` : ''}${tags}`;
    };
    const byRecent = [...this.notes].sort((a, b) => b.mtimeMs - a.mtimeMs);
    const total = byRecent.reduce((sum, n) => sum + line(n).length + 1, 0);
    let order = byRecent;
    if (total > budget) {
      const degree = new Map(this.graph().notes.map((n) => [n.path, n.degree]));
      // A ordenação é estável: notas com o mesmo número de ligações continuam da mais recente para a mais antiga.
      order = [...byRecent].sort((a, b) => (degree.get(b.path) ?? 0) - (degree.get(a.path) ?? 0));
    }
    const lines: string[] = [];
    let used = 0;
    for (const n of order) {
      const text = line(n);
      if (used + text.length > budget) break;
      lines.push(text);
      used += text.length + 1;
    }
    return { lines, omitted: order.length - lines.length };
  }
}

const READ_CONCURRENCY = 16;

/**
 * Monta o índice lendo o vault, sem travar o processo main: as notas são lidas em paralelo e de forma assíncrona.
 * Na primeira leitura de arquivos novos, o antivírus do Windows examina cada um (~7 ms por arquivo no Electron);
 * em paralelo isso cai pela metade e a interface e o chat continuam respondendo enquanto isso.
 *
 * Com o índice anterior, só relê as notas cujo mtime mudou: depois de uma alteração, o vault não é lido inteiro.
 */
export async function buildIndex(vault: Vault, previous?: NoteIndex): Promise<NoteIndex> {
  const files = vault.listNotes();
  const metas = new Array<NoteMeta | null>(files.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const k = next++;
      const file = files[k]!;
      const known = previous?.get(file.path);
      if (known && known.mtimeMs === file.mtimeMs) {
        metas[k] = known;
        continue;
      }
      try {
        const content = await vault.readListed(file.path);
        const parsed = parseNote(content, path.posix.basename(file.path));
        metas[k] = {
          chars: content.length,
          path: file.path,
          title: parsed.title,
          summary: parsed.summary,
          tags: parsed.tags,
          links: parsed.links.map((l) => l.target),
          aliases: parsed.aliases,
          mtimeMs: file.mtimeMs,
        };
      } catch {
        // Nota que sumiu ou não pôde ser lida durante a varredura: fica fora desta vez.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, files.length) }, worker));
  // Mesma ordem da varredura, qualquer que seja a ordem em que as leituras terminaram.
  return new NoteIndex(metas.filter((m): m is NoteMeta => m !== null));
}
