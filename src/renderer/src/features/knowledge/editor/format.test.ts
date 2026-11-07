import { EditorSelection, EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { blockKindOf, colorSpanAt, setBlock, setTextColor, toggleWrap } from './format';

const state = (doc: string, anchor: number, head = anchor) =>
  EditorState.create({ doc, selection: EditorSelection.single(anchor, head) });
const apply = (s: EditorState, spec: ReturnType<typeof toggleWrap>) => s.update(spec).state;
const text = (s: EditorState) => s.doc.toString();

describe('toggleWrap', () => {
  it('envolve a seleção e mantém o texto selecionado', () => {
    const start = state('uma palavra', 4, 11);
    const s = apply(start, toggleWrap(start, '**'));
    expect(text(s)).toBe('uma **palavra**');
    expect(s.sliceDoc(s.selection.main.from, s.selection.main.to)).toBe('palavra');
  });

  it('tira os marcadores quando já estão em volta ou dentro da seleção', () => {
    const outside = state('uma **palavra**', 6, 13);
    expect(text(apply(outside, toggleWrap(outside, '**')))).toBe('uma palavra');
    const inside = state('uma **palavra**', 4, 15);
    expect(text(apply(inside, toggleWrap(inside, '**')))).toBe('uma palavra');
  });

  it('sem seleção, abre o par e deixa o cursor entre os marcadores', () => {
    const start = state('oi ', 3);
    const s = apply(start, toggleWrap(start, '*'));
    expect(text(s)).toBe('oi **');
    expect(s.selection.main.head).toBe(4);
  });
});

describe('setBlock', () => {
  it('vira título, lista, tarefa e citação', () => {
    for (const [kind, expected] of [
      ['h1', '# item'],
      ['h2', '## item'],
      ['bullet', '- item'],
      ['task', '- [ ] item'],
      ['quote', '> item'],
    ] as const) {
      const s = state('item', 2);
      expect(text(apply(s, setBlock(s, kind)))).toBe(expected);
    }
  });

  it('troca o tipo que já existia e desfaz ao repetir', () => {
    const s = state('## Título', 4);
    expect(text(apply(s, setBlock(s, 'bullet')))).toBe('- Título');
    const again = state('- [ ] fazer', 5);
    expect(text(apply(again, setBlock(again, 'task')))).toBe('fazer');
  });

  it('numera várias linhas em sequência e preserva o recuo', () => {
    const s = state('a\n  b\nc', 0, 7);
    expect(text(apply(s, setBlock(s, 'number')))).toBe('1. a\n  2. b\n3. c');
  });

  it('deixa o cursor depois do marcador, mesmo vindo do começo da linha', () => {
    const s = state('item', 0);
    expect(apply(s, setBlock(s, 'h1')).selection.main.head).toBe(2);
    const t = state('item', 2);
    expect(apply(t, setBlock(t, 'task')).selection.main.head).toBe(8);
  });

  it('reconhece o tipo de cada linha', () => {
    expect(blockKindOf('### x')).toBe('h3');
    expect(blockKindOf('- [x] x')).toBe('task');
    expect(blockKindOf('3. x')).toBe('number');
    expect(blockKindOf('* x')).toBe('bullet');
    expect(blockKindOf('> x')).toBe('quote');
    expect(blockKindOf('x')).toBe('paragraph');
  });
});

describe('setTextColor', () => {
  it('pinta a seleção, troca a cor e limpa', () => {
    let s = state('texto importante aqui', 6, 16);
    s = apply(s, setTextColor(s, '#e03e3e'));
    expect(text(s)).toBe('texto <span style="color:#e03e3e">importante</span> aqui');
    expect(s.sliceDoc(s.selection.main.from, s.selection.main.to)).toBe('importante');

    s = apply(s, setTextColor(s, '#2e86c1'));
    expect(text(s)).toBe('texto <span style="color:#2e86c1">importante</span> aqui');

    s = apply(s, setTextColor(s, null));
    expect(text(s)).toBe('texto importante aqui');
  });

  it('sem seleção, pinta a palavra sob o cursor', () => {
    const s = state('olá mundo', 6);
    expect(text(apply(s, setTextColor(s, '#2f9e6d')))).toBe('olá <span style="color:#2f9e6d">mundo</span>');
  });

  it('encontra o trecho colorido que contém o cursor', () => {
    const s = state('a <span style="color:#e03e3e">oi</span> b', 31);
    expect(colorSpanAt(s, 31, 31)).toMatchObject({ innerFrom: 30, innerTo: 32 });
    expect(colorSpanAt(s, 0, 0)).toBeNull();
  });
});
