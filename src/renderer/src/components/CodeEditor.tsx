import { indentLess, indentMore } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState, Prec } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { GFM } from '@lezer/markdown';
import { EditorView, minimalSetup } from 'codemirror';
import { toggleWrap } from '@renderer/features/knowledge/editor/format';
import { livePreview, livePreviewTheme } from '@renderer/features/knowledge/editor/live-preview';
import { slashMenu } from '@renderer/features/knowledge/editor/slash-commands';
import { useEffect, useRef } from 'react';

/** Cores do Markdown no editor, com os tokens do app (claro e escuro); a marcação fica discreta, como no Obsidian. */
const highlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '1.3em', fontWeight: '600' },
  { tag: tags.heading2, fontSize: '1.15em', fontWeight: '600' },
  { tag: [tags.heading3, tags.heading4, tags.heading5, tags.heading6], fontWeight: '600' },
  { tag: tags.strong, fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: 'var(--accent)' },
  { tag: tags.monospace, fontFamily: 'var(--font-mono)', fontSize: '0.9em' },
  { tag: tags.quote, color: 'var(--text-muted)' },
  // `tags.list` fica de fora: ele cobre o item inteiro, não só o marcador (que é `processingInstruction`).
  { tag: [tags.processingInstruction, tags.meta, tags.contentSeparator], color: 'var(--text-muted)' },
]);

/** Na visualização ao vivo o tamanho dos títulos vem da linha (ver live-preview.ts), não do trecho. */
const richHighlight = HighlightStyle.define([
  {
    tag: [tags.heading1, tags.heading2, tags.heading3, tags.heading4, tags.heading5, tags.heading6],
    fontWeight: '600',
  },
  { tag: tags.strong, fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: 'var(--accent)' },
  { tag: tags.monospace, fontFamily: 'var(--font-mono)', fontSize: '0.9em' },
  { tag: [tags.processingInstruction, tags.meta, tags.contentSeparator], color: 'var(--text-muted)' },
]);

const isListLine = (view: EditorView) =>
  /^\s*([-*+]|\d+[.)])\s/.test(view.state.doc.lineAt(view.state.selection.main.head).text);

/** Atalhos da edição de notas: Tab recua item de lista (fora de lista, o Tab segue para o próximo controle). */
const noteKeymap = Prec.high(
  keymap.of([
    { key: 'Tab', run: (v) => isListLine(v) && indentMore(v) },
    { key: 'Shift-Tab', run: (v) => isListLine(v) && indentLess(v) },
    { key: 'Mod-i', run: (v) => (v.dispatch(toggleWrap(v.state, '*')), true) },
  ]),
);

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '14px', backgroundColor: 'transparent', color: 'var(--text)' },
  '.cm-content': { fontFamily: 'var(--font-sans)', padding: '12px 0', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0 14px', lineHeight: '1.65' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--accent-soft) !important',
  },
  '.cm-scroller': { overflow: 'auto' },
});

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Rótulo acessível do editor. */
  label: string;
  onSave?: () => void;
  /** Visualização ao vivo (títulos, listas, tarefas e cores aparecem formatados), comandos "/" e atalhos de nota. */
  rich?: boolean;
  /** Entrega o editor a quem precisa agir sobre o texto (a barra de formatação); `null` quando ele é destruído. */
  onView?: (view: EditorView | null) => void;
}

/**
 * Editor de Markdown (CodeMirror 6, o mesmo motor do Obsidian). O texto vindo de fora (ex.: nota recarregada)
 * substitui o conteúdo sem recriar o editor.
 */
export function CodeEditor({ value, onChange, label, onSave, rich, onView }: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const handlers = useRef({ onChange, onSave, onView });
  handlers.current = { onChange, onSave, onView };

  useEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          minimalSetup,
          rich ? markdown({ extensions: GFM }) : markdown(),
          syntaxHighlighting(rich ? richHighlight : highlight),
          ...(rich ? [livePreview, livePreviewTheme, slashMenu, noteKeymap] : []),
          EditorView.lineWrapping,
          theme,
          EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'true' }),
          EditorView.domEventHandlers({
            keydown: (e) => {
              if (e.ctrlKey && e.key.toLowerCase() === 's') {
                e.preventDefault();
                handlers.current.onSave?.();
                return true;
              }
              return false;
            },
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) handlers.current.onChange(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    handlers.current.onView?.(editor);
    return () => {
      handlers.current.onView?.(null);
      editor.destroy();
    };
    // O editor é criado uma vez; mudanças de `value` vêm pelo efeito abaixo.
  }, []);

  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value) {
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
    }
  }, [value]);

  return <div ref={host} className="h-full min-h-0" data-testid="code-editor" />;
}
