import { ChangeSet, EditorSelection, type ChangeSpec, type EditorState, type TransactionSpec } from '@codemirror/state';
import { COLOR_CLOSE_TAG, COLOR_SPAN, colorOpenTag } from './note-colors';

/** Alterna marcadores em volta da seleção (ex.: `**` para negrito). Sem seleção, abre um par e fica entre eles. */
export function toggleWrap(state: EditorState, open: string, close = open): TransactionSpec {
  return state.changeByRange((range) => {
    const { from, to } = range;
    const before = state.sliceDoc(from - open.length, from);
    const after = state.sliceDoc(to, to + close.length);
    if (from !== to && before === open && after === close) {
      // Marcadores logo fora da seleção: tira.
      return {
        changes: [
          { from: from - open.length, to: from },
          { from: to, to: to + close.length },
        ],
        range: EditorSelection.range(from - open.length, to - open.length),
      };
    }
    const text = state.sliceDoc(from, to);
    if (text.length >= open.length + close.length && text.startsWith(open) && text.endsWith(close)) {
      // Marcadores dentro da seleção: tira.
      const inner = text.slice(open.length, text.length - close.length);
      return {
        changes: { from, to, insert: inner },
        range: EditorSelection.range(from, from + inner.length),
      };
    }
    return {
      changes: [
        { from, insert: open },
        { from: to, insert: close },
      ],
      range: EditorSelection.range(from + open.length, to + open.length),
    };
  });
}

export type BlockKind = 'paragraph' | 'h1' | 'h2' | 'h3' | 'bullet' | 'number' | 'task' | 'quote';

const BLOCK_PREFIX = /^(\s*)(#{1,6} |- \[[ xX]\] |[-*+] |\d+[.)] |> ?)/;

const prefixOf = (kind: BlockKind, index: number): string =>
  ({
    paragraph: '',
    h1: '# ',
    h2: '## ',
    h3: '### ',
    bullet: '- ',
    number: `${index + 1}. `,
    task: '- [ ] ',
    quote: '> ',
  })[kind];

/** Que tipo de bloco uma linha já é (para alternar: aplicar de novo o mesmo tipo volta a texto). */
export function blockKindOf(line: string): BlockKind {
  const m = BLOCK_PREFIX.exec(line);
  if (!m) return 'paragraph';
  const marker = m[2]!;
  if (marker.startsWith('#')) return marker.length === 2 ? 'h1' : marker.length === 3 ? 'h2' : 'h3';
  if (marker.startsWith('- [')) return 'task';
  if (/^\d/.test(marker)) return 'number';
  if (marker.startsWith('>')) return 'quote';
  return 'bullet';
}

/** Troca o tipo de bloco de todas as linhas da seleção (título, lista, tarefa, citação ou texto). */
export function setBlock(state: EditorState, kind: BlockKind): TransactionSpec {
  const lines: Array<{ from: number; text: string }> = [];
  const seen = new Set<number>();
  for (const range of state.selection.ranges) {
    for (let pos = state.doc.lineAt(range.from).from; pos <= range.to;) {
      const line = state.doc.lineAt(pos);
      if (!seen.has(line.from)) {
        seen.add(line.from);
        lines.push({ from: line.from, text: line.text });
      }
      pos = line.to + 1;
    }
  }
  // Se todas as linhas já são deste tipo, a ação desfaz (volta a texto).
  const target: BlockKind =
    kind !== 'paragraph' && lines.every((l) => blockKindOf(l.text) === kind) ? 'paragraph' : kind;
  const changes: ChangeSpec[] = lines.map((l, i) => {
    const indent = /^\s*/.exec(l.text)![0];
    const marker = BLOCK_PREFIX.exec(l.text)?.[2] ?? '';
    return { from: l.from + indent.length, to: l.from + indent.length + marker.length, insert: prefixOf(target, i) };
  });
  // O cursor acompanha o texto: se estava no começo da linha, fica depois do marcador novo.
  return { changes, selection: state.selection.map(ChangeSet.of(changes, state.doc.length), 1) };
}

export interface ColorSpanAt {
  from: number;
  to: number;
  innerFrom: number;
  innerTo: number;
}

/** Trecho colorido (`<span style="color:…">…</span>`) que contém a seleção na linha, se houver. */
export function colorSpanAt(state: EditorState, from: number, to: number): ColorSpanAt | null {
  const line = state.doc.lineAt(from);
  if (to > line.to) return null;
  for (const m of line.text.matchAll(COLOR_SPAN)) {
    const start = line.from + m.index;
    const innerFrom = start + m[0].indexOf('>') + 1;
    const innerTo = innerFrom + m[2]!.length;
    if (from >= start && to <= start + m[0].length) return { from: start, to: start + m[0].length, innerFrom, innerTo };
  }
  return null;
}

/**
 * Pinta a seleção com uma cor (ou limpa a cor com `null`). Dentro de um trecho já colorido, troca a cor dele.
 * Sem seleção, usa a palavra sob o cursor.
 */
export function setTextColor(state: EditorState, hex: string | null): TransactionSpec {
  return state.changeByRange((range) => {
    const existing = colorSpanAt(state, range.from, range.to);
    if (existing) {
      const inner = state.sliceDoc(existing.innerFrom, existing.innerTo);
      const open = hex ? colorOpenTag(hex) : '';
      const insert = hex ? `${open}${inner}${COLOR_CLOSE_TAG}` : inner;
      return {
        changes: { from: existing.from, to: existing.to, insert },
        range: EditorSelection.range(existing.from + open.length, existing.from + open.length + inner.length),
      };
    }
    if (!hex) return { range };
    let { from, to } = range;
    if (from === to) {
      const word = state.wordAt(from);
      if (!word) return { range };
      ({ from, to } = word);
    }
    const open = colorOpenTag(hex);
    return {
      changes: [
        { from, insert: open },
        { from: to, insert: COLOR_CLOSE_TAG },
      ],
      range: EditorSelection.range(from + open.length, to + open.length),
    };
  });
}
