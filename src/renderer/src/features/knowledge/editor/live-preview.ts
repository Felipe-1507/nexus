import { syntaxTree } from '@codemirror/language';
import { type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { COLOR_SPAN } from './note-colors';

/**
 * Visualização ao vivo, como no Obsidian: o texto continua sendo Markdown puro (nada é reescrito), mas fora do
 * trecho onde está o cursor a marcação some e o resultado aparece (títulos, negrito, listas, tarefas, cores).
 */

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  override eq(other: CheckboxWidget) {
    return other.checked === this.checked;
  }
  override toDOM(view: EditorView) {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = this.checked;
    box.className = 'cm-task-box';
    box.setAttribute('aria-label', this.checked ? 'Tarefa concluída' : 'Tarefa pendente');
    // Não rouba o foco nem move o cursor do texto.
    box.addEventListener('mousedown', (e) => e.preventDefault());
    box.addEventListener('click', (e) => {
      e.preventDefault();
      const pos = view.posAtDOM(box);
      if (/^\[[ xX]\]$/.test(view.state.sliceDoc(pos, pos + 3))) {
        view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: this.checked ? ' ' : 'x' } });
      }
    });
    return box;
  }
  override ignoreEvent() {
    return true;
  }
}

class StaticWidget extends WidgetType {
  constructor(
    readonly className: string,
    readonly text = '',
  ) {
    super();
  }
  override eq(other: StaticWidget) {
    return other.className === this.className && other.text === this.text;
  }
  override toDOM() {
    const el = document.createElement('span');
    el.className = this.className;
    el.textContent = this.text;
    return el;
  }
}

const hidden = Decoration.replace({});
const bullet = Decoration.replace({ widget: new StaticWidget('cm-bullet', '•') });
const rule = Decoration.replace({ widget: new StaticWidget('cm-hr') });
const lineClass = (name: string) => Decoration.line({ class: name });

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const out: Range<Decoration>[] = [];
  const selection = state.selection.ranges;
  const touches = (from: number, to: number) => selection.some((r) => r.from <= to && r.to >= from);
  const lineActive = (pos: number) => {
    const line = state.doc.lineAt(pos);
    return touches(line.from, line.to);
  };
  const hide = (from: number, to: number) => {
    if (from < to) out.push(hidden.range(from, to));
  };
  const lineClasses = (from: number, to: number, name: string) => {
    for (let pos = from; pos <= to;) {
      const line = state.doc.lineAt(pos);
      out.push(lineClass(name).range(line.from));
      pos = line.to + 1;
    }
  };
  const codeRanges: Array<[number, number]> = [];
  // O frontmatter (--- … ---, propriedades da nota) fica como texto: não é Markdown.
  const frontmatter = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(state.sliceDoc(0, 20_000));
  const frontmatterEnd = frontmatter ? frontmatter[0].length : 0;
  if (frontmatter) {
    codeRanges.push([0, frontmatterEnd]);
    lineClasses(0, Math.max(0, frontmatterEnd - 1), 'cm-frontmatter');
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;
        if (frontmatterEnd && name !== 'Document' && node.to <= frontmatterEnd) return false;
        const heading = /^ATXHeading([1-6])$/.exec(name);
        if (heading) {
          out.push(lineClass(`cm-h${heading[1]}`).range(state.doc.lineAt(node.from).from));
        } else if (name === 'HeaderMark' && node.node.parent?.name.startsWith('ATXHeading')) {
          if (!lineActive(node.from)) hide(node.from, Math.min(node.to + 1, state.doc.lineAt(node.from).to));
        } else if (name === 'EmphasisMark' || name === 'StrikethroughMark' || name === 'CodeMark') {
          const parent = node.node.parent;
          if (parent && (name !== 'CodeMark' || parent.name === 'InlineCode') && !touches(parent.from, parent.to)) {
            hide(node.from, node.to);
          }
        } else if (name === 'LinkMark' || name === 'URL' || name === 'LinkTitle') {
          const parent = node.node.parent;
          // Só links com endereço, `[texto](url)`: os `[[notas]]` são tratados mais abaixo.
          if (parent?.name === 'Link' && parent.getChild('URL') && !touches(parent.from, parent.to)) {
            hide(node.from, node.to);
          }
        } else if (name === 'TaskMarker') {
          const checked = /x/i.test(state.sliceDoc(node.from, node.to));
          out.push(Decoration.replace({ widget: new CheckboxWidget(checked) }).range(node.from, node.to));
          if (checked) out.push(lineClass('cm-task-done').range(state.doc.lineAt(node.from).from));
        } else if (name === 'ListMark') {
          const item = node.node.parent;
          const kind = item?.parent?.name;
          const task = item?.getChild('Task');
          if (task) {
            if (!lineActive(node.from)) hide(node.from, Math.min(node.to + 1, state.doc.lineAt(node.from).to));
          } else if (kind === 'BulletList' && !lineActive(node.from)) {
            out.push(bullet.range(node.from, node.to));
          }
        } else if (name === 'Blockquote') {
          lineClasses(node.from, node.to, 'cm-quote');
        } else if (name === 'QuoteMark') {
          if (!lineActive(node.from)) {
            const line = state.doc.lineAt(node.from);
            hide(node.from, Math.min(node.to + 1, line.to));
          }
        } else if (name === 'HorizontalRule') {
          if (lineActive(node.from)) out.push(lineClass('cm-hr-source').range(state.doc.lineAt(node.from).from));
          else out.push(rule.range(node.from, node.to));
        } else if (name === 'FencedCode' || name === 'CodeBlock') {
          codeRanges.push([node.from, node.to]);
          lineClasses(node.from, node.to, 'cm-codeblock');
        }
      },
    });
  }

  // Cores, links para notas e #etiquetas: reconhecidos pelo texto, linha a linha, fora de blocos de código.
  const tree = syntaxTree(state);
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      if (codeRanges.some(([a, b]) => line.from >= a && line.from <= b)) continue;
      const inCode = (at: number) => /InlineCode|CodeText/.test(tree.resolveInner(at, 1).name);

      for (const m of line.text.matchAll(COLOR_SPAN)) {
        const start = line.from + m.index;
        const end = start + m[0].length;
        if (inCode(start)) continue;
        const innerFrom = start + m[0].indexOf('>') + 1;
        const innerTo = innerFrom + m[2]!.length;
        out.push(Decoration.mark({ attributes: { style: `color:${m[1]}` } }).range(innerFrom, innerTo));
        if (!touches(start, end)) {
          hide(start, innerFrom);
          hide(innerTo, end);
        }
      }
      for (const m of line.text.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
        const start = line.from + m.index;
        const end = start + m[0].length;
        if (inCode(start)) continue;
        out.push(Decoration.mark({ class: 'cm-wikilink' }).range(start, end));
        if (!touches(start, end)) {
          hide(start, start + 2);
          hide(end - 2, end);
        }
      }
      for (const m of line.text.matchAll(/(?<=^|\s)#[\p{L}\p{N}_/-]+/gu)) {
        const start = line.from + m.index;
        if (!inCode(start)) out.push(Decoration.mark({ class: 'cm-tag' }).range(start, start + m[0].length));
      }
    }
  }
  return Decoration.set(out, true);
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.startState) !== syntaxTree(u.state)) {
        this.decorations = build(u.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

export const livePreviewTheme = EditorView.theme({
  '.cm-h1': { fontSize: '1.7em', fontWeight: '700', lineHeight: '1.3' },
  '.cm-h2': { fontSize: '1.4em', fontWeight: '700', lineHeight: '1.3' },
  '.cm-h3': { fontSize: '1.2em', fontWeight: '600' },
  '.cm-h4, .cm-h5, .cm-h6': { fontSize: '1.05em', fontWeight: '600' },
  '.cm-line.cm-quote': {
    borderLeft: '3px solid var(--accent)',
    marginLeft: '14px',
    paddingLeft: '11px',
    color: 'var(--text-muted)',
  },
  '.cm-line.cm-codeblock': {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.9em',
    backgroundColor: 'var(--surface-2)',
  },
  '.cm-line.cm-task-done': { color: 'var(--text-muted)', textDecoration: 'line-through' },
  '.cm-task-box': { margin: '0 6px 0 0', verticalAlign: 'middle', accentColor: 'var(--accent)', cursor: 'pointer' },
  '.cm-bullet': { color: 'var(--text-muted)', fontWeight: '700', display: 'inline-block', width: '1.1em' },
  '.cm-hr': { display: 'inline-block', width: '100%', borderTop: '1px solid var(--border)', verticalAlign: 'middle' },
  '.cm-wikilink': { color: 'var(--accent)', textDecoration: 'underline', textDecorationStyle: 'dotted' },
  '.cm-tag': { color: 'var(--accent)' },
  '.cm-line.cm-frontmatter': { fontFamily: 'var(--font-mono)', fontSize: '0.85em', color: 'var(--text-muted)' },
});
