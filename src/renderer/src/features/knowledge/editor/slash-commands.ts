import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { EditorView } from '@codemirror/view';
import { setBlock, type BlockKind } from './format';
import { colorOpenTag, COLOR_CLOSE_TAG, NOTE_COLORS } from './note-colors';

/** Menu de comandos ao digitar "/", como no Notion. Tudo vira Markdown comum no arquivo. */
interface SlashItem {
  label: string;
  detail: string;
  /** Palavras extras para a busca (sem acento). */
  keywords: string;
  run: (view: EditorView, from: number, to: number) => void;
}

const normalize = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Troca o "/consulta" por um texto, com o cursor (ou uma seleção) onde o comando pede. */
function insert(view: EditorView, from: number, to: number, text: string, select?: [number, number]) {
  view.dispatch({
    changes: { from, to, insert: text },
    selection: select ? { anchor: from + select[0], head: from + select[1] } : { anchor: from + text.length },
    scrollIntoView: true,
  });
}

function block(kind: BlockKind): SlashItem['run'] {
  return (view, from, to) => {
    view.dispatch({ changes: { from, to }, selection: { anchor: from } });
    view.dispatch(setBlock(view.state, kind));
  };
}

const ITEMS: SlashItem[] = [
  { label: 'Texto', detail: 'Parágrafo simples', keywords: 'paragrafo normal', run: block('paragraph') },
  { label: 'Título 1', detail: 'Título grande', keywords: 'h1 heading cabecalho', run: block('h1') },
  { label: 'Título 2', detail: 'Título médio', keywords: 'h2 heading cabecalho', run: block('h2') },
  { label: 'Título 3', detail: 'Título pequeno', keywords: 'h3 heading cabecalho', run: block('h3') },
  { label: 'Lista', detail: 'Lista com marcadores', keywords: 'bullet marcadores topicos', run: block('bullet') },
  { label: 'Lista numerada', detail: '1. 2. 3.', keywords: 'numero ordenada', run: block('number') },
  { label: 'Lista de tarefas', detail: 'Caixas de seleção', keywords: 'checkbox todo checklist', run: block('task') },
  { label: 'Citação', detail: 'Destaque de trecho', keywords: 'quote bloco', run: block('quote') },
  {
    label: 'Chamada',
    detail: 'Aviso destacado (callout)',
    keywords: 'callout nota aviso destaque',
    run: (view, from, to) => insert(view, from, to, '> [!note]\n> ', [0, 0]),
  },
  {
    label: 'Bloco de código',
    detail: 'Texto em fonte monoespaçada',
    keywords: 'code codigo programacao',
    run: (view, from, to) => {
      insert(view, from, to, '```\n\n```', [4, 4]);
    },
  },
  {
    label: 'Divisor',
    detail: 'Linha horizontal',
    keywords: 'linha separador hr',
    run: (view, from, to) => insert(view, from, to, '---\n'),
  },
  {
    label: 'Tabela',
    detail: 'Tabela com 2 colunas',
    keywords: 'colunas linhas grade',
    run: (view, from, to) => insert(view, from, to, '| Coluna 1 | Coluna 2 |\n| --- | --- |\n|  |  |\n'),
  },
  {
    label: 'Link para nota',
    detail: '[[Nome da nota]]',
    keywords: 'wikilink referencia mencionar',
    run: (view, from, to) => insert(view, from, to, '[[]]', [2, 2]),
  },
  ...NOTE_COLORS.map((c): SlashItem => ({
    label: `Texto ${c.label.toLowerCase()}`,
    detail: 'Cor do texto',
    keywords: `cor colorido ${c.id}`,
    run: (view, from, to) => {
      const open = colorOpenTag(c.hex);
      insert(view, from, to, `${open}texto${COLOR_CLOSE_TAG}`, [open.length, open.length + 5]);
    },
  })),
];

/** "/" no começo da linha ou depois de um espaço abre o menu; o texto digitado depois filtra os comandos. */
export function slashCompletions(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(/(?:^|\s)\/[^\s/]*$/);
  if (!match) return null;
  const from = match.from + (match.text.startsWith('/') ? 0 : 1);
  const query = normalize(context.state.sliceDoc(from + 1, context.pos));
  const options: Completion[] = ITEMS.filter(
    (i) => !query || normalize(`${i.label} ${i.keywords}`).includes(query),
  ).map((item) => ({
    label: item.label,
    detail: item.detail,
    apply: (view, _completion, start, end) => item.run(view, start, end),
  }));
  return options.length ? { from, options, filter: false } : null;
}

export const slashMenu = [
  autocompletion({ override: [slashCompletions], icons: false, activateOnTyping: true }),
  EditorView.theme({
    '.cm-tooltip.cm-tooltip-autocomplete': {
      border: '1px solid var(--border)',
      backgroundColor: 'var(--surface)',
      borderRadius: '10px',
      overflow: 'hidden',
      boxShadow: '0 8px 24px rgb(0 0 0 / 0.18)',
    },
    '.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-sans)', fontSize: '13px', maxHeight: '280px' },
    '.cm-tooltip-autocomplete > ul > li': { padding: '5px 12px', color: 'var(--text)' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'var(--accent-soft)',
      color: 'var(--text)',
    },
    '.cm-completionDetail': { color: 'var(--text-muted)', marginLeft: '0.8em', fontStyle: 'normal', fontSize: '11px' },
  }),
];
