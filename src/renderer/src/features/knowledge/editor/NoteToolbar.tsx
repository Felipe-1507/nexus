import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Palette,
  Quote,
  Strikethrough,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { EditorView } from '@codemirror/view';
import { IconButton } from '@renderer/components/ui/IconButton';
import { setBlock, setTextColor, toggleWrap, type BlockKind } from './format';
import { NOTE_COLORS } from './note-colors';

/** Barra de formatação da nota. Age no texto selecionado (ou na linha do cursor) sem tirar o foco do editor. */
export function NoteToolbar({ view }: { view: EditorView | null }) {
  const [colors, setColors] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!colors) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setColors(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setColors(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [colors]);

  const run = (action: (v: EditorView) => void) => {
    if (!view) return;
    action(view);
    view.focus();
  };
  const wrap = (open: string, close = open) => run((v) => v.dispatch(toggleWrap(v.state, open, close)));
  const block = (kind: BlockKind) => run((v) => v.dispatch(setBlock(v.state, kind)));
  const color = (hex: string | null) => {
    run((v) => v.dispatch(setTextColor(v.state, hex)));
    setColors(false);
  };

  const button = (label: string, onClick: () => void, icon: ReactNode) => (
    <IconButton
      key={label}
      label={label}
      className="size-7"
      disabled={!view}
      // Mantém a seleção do texto: o botão não pode roubar o foco do editor.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {icon}
    </IconButton>
  );
  const divider = (key: string) => <span key={key} aria-hidden className="mx-0.5 h-4 w-px bg-border" />;

  return (
    <div
      role="toolbar"
      aria-label="Formatação da nota"
      className="flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1"
      data-testid="note-toolbar"
    >
      {button('Título 1', () => block('h1'), <Heading1 size={14} />)}
      {button('Título 2', () => block('h2'), <Heading2 size={14} />)}
      {button('Título 3', () => block('h3'), <Heading3 size={14} />)}
      {divider('d1')}
      {button('Negrito', () => wrap('**'), <Bold size={14} />)}
      {button('Itálico', () => wrap('*'), <Italic size={14} />)}
      {button('Tachado', () => wrap('~~'), <Strikethrough size={14} />)}
      {button('Código', () => wrap('`'), <Code size={14} />)}
      <div ref={root} className="relative">
        {button('Cor do texto', () => setColors((o) => !o), <Palette size={14} />)}
        {colors && (
          <div
            role="dialog"
            aria-label="Cor do texto"
            className="absolute top-full left-0 z-20 mt-1 w-44 rounded-xl border border-border bg-surface p-2 shadow-lg"
          >
            <div className="grid grid-cols-5 gap-1.5">
              {NOTE_COLORS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-label={`Cor ${c.label}`}
                  title={c.label}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => color(c.hex)}
                  className="size-6 rounded-full border border-border focus-visible:outline-2 focus-visible:outline-accent"
                  style={{ backgroundColor: c.hex }}
                />
              ))}
            </div>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => color(null)}
              className="mt-2 w-full rounded-md px-2 py-1 text-left text-xs text-muted hover:bg-surface-2 hover:text-text"
            >
              Sem cor
            </button>
          </div>
        )}
      </div>
      {divider('d2')}
      {button('Lista com marcadores', () => block('bullet'), <List size={14} />)}
      {button('Lista numerada', () => block('number'), <ListOrdered size={14} />)}
      {button('Lista de tarefas', () => block('task'), <ListChecks size={14} />)}
      {button('Citação', () => block('quote'), <Quote size={14} />)}
      {button('Link para nota', () => wrap('[[', ']]'), <Link2 size={14} />)}
    </div>
  );
}
