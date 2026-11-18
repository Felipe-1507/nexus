/**
 * Texto da busca nas conversas: compara sem diferenciar maiúsculas nem acentos ("situacao" acha "situação") e devolve
 * um trecho do texto original com a posição das palavras achadas, para a tela destacá-las.
 */

const MARKS = /\p{M}/gu;
const MAX_TERMS = 8;
/** Quanto do texto aparece antes e depois da primeira palavra achada. */
const BEFORE = 70;
const AFTER = 150;
/** Ocorrências marcadas no trecho (mais que isso não ajuda a ler). */
const MAX_MARKS = 40;

/** Minúsculas e sem acentos. */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(MARKS, '').toLowerCase();
}

/** Palavras da busca: separadas por espaço; o que está entre aspas vale como uma só. Todas precisam aparecer. */
export function parseQuery(query: string): string[] {
  const terms: string[] = [];
  for (const m of query.matchAll(/"([^"]+)"|(\S+)/g)) {
    const term = foldText((m[1] ?? m[2] ?? '').trim()).replace(/\s+/g, ' ');
    if (term && !terms.includes(term)) terms.push(term);
    if (terms.length >= MAX_TERMS) break;
  }
  return terms;
}

/** O texto já sem maiúsculas/acentos tem todas as palavras? (`folded` vem de `foldText`.) */
export function hasAll(folded: string, terms: string[]): boolean {
  return terms.length > 0 && terms.every((t) => folded.includes(t));
}

/** Texto sem maiúsculas/acentos e o mapa de cada letra dele para o começo e o fim da letra no original. */
function foldWithMap(text: string): { folded: string; starts: number[]; ends: number[] } {
  let folded = '';
  const starts: number[] = [];
  const ends: number[] = [];
  for (let i = 0; i < text.length;) {
    const ch = String.fromCodePoint(text.codePointAt(i)!);
    const f = foldText(ch);
    for (let k = 0; k < f.length; k++) {
      starts.push(i);
      ends.push(i + ch.length);
    }
    folded += f;
    i += ch.length;
  }
  return { folded, starts, ends };
}

export interface Excerpt {
  text: string;
  ranges: Array<[number, number]>;
}

/** Trecho do texto em volta da primeira palavra achada, com as posições das palavras dentro dele. `null` = não achou. */
export function excerpt(text: string, terms: string[]): Excerpt | null {
  const { folded, starts, ends } = foldWithMap(text);
  /** Ocorrências, em posições do texto original. */
  const found: Array<[number, number]> = [];
  for (const term of terms) {
    for (let at = folded.indexOf(term); at >= 0 && found.length < 500; at = folded.indexOf(term, at + term.length)) {
      found.push([starts[at]!, ends[at + term.length - 1]!]);
    }
  }
  if (found.length === 0) return null;
  found.sort((a, b) => a[0] - b[0] || b[1] - a[1]);

  const anchor = found[0]![0];
  let from = Math.max(0, anchor - BEFORE);
  let to = Math.min(text.length, anchor + AFTER);
  // Não corta no meio de uma palavra (nem de um par de substituição): recua para o espaço mais próximo.
  if (from > 0) {
    const space = text.slice(from, anchor).search(/\s/);
    from = space >= 0 ? from + space + 1 : from;
  }
  if (to < text.length) {
    const base = Math.max(anchor, to - 25);
    const space = text.slice(base, to).search(/\s\S*$/);
    if (space >= 0) to = base + space;
  }

  const lead = from > 0 ? '…' : '';
  const tail = to < text.length ? '…' : '';
  // Cada espaço em branco vira um espaço simples (um por um), para as posições continuarem valendo.
  const body = text.slice(from, to).replace(/\s/g, ' ');

  const ranges: Array<[number, number]> = [];
  for (const [s, e] of found) {
    const start = Math.max(s, from) - from + lead.length;
    const end = Math.min(e, to) - from + lead.length;
    if (start >= end) continue;
    const last = ranges.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else ranges.push([start, end]);
    if (ranges.length >= MAX_MARKS) break;
  }
  return { text: lead + body + tail, ranges };
}
