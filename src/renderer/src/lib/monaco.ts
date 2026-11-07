import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import CssWorker from 'monaco-editor/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import { useEffect, useState } from 'react';
import type { Palette } from '@shared/palette';
import { currentPalette, onPaletteChange } from './appearance';

/**
 * Monaco empacotado junto com o app: o @monaco-editor/react, por padrão, baixaria o editor de uma CDN, o que o
 * CSP bloqueia (e o Nexus não carrega nada da internet). Os workers saem do próprio pacote.
 */
self.MonacoEnvironment = {
  getWorker(_id, label) {
    if (label === 'json') return new JsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker();
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    return new EditorWorker();
  },
};
// O arquivo é aberto sozinho, sem o resto do projeto: a checagem de tipos acusaria erros que não existem.
for (const defaults of [monaco.typescript.typescriptDefaults, monaco.typescript.javascriptDefaults]) {
  defaults.setDiagnosticsOptions({ noSemanticValidation: true, noSuggestionDiagnostics: true });
}
loader.config({ monaco });

// Fundo, margem e seleção com as cores do app (a paleta em uso); o realce de sintaxe é o padrão.
const solid = (hex: string) => hex.slice(0, 7);
const dark = window.matchMedia('(prefers-color-scheme: dark)');

function defineThemes(palette: Palette): void {
  for (const [name, base, c] of [
    ['nexus-dark', 'vs-dark', palette.dark],
    ['nexus-light', 'vs', palette.light],
  ] as const) {
    monaco.editor.defineTheme(name, {
      base,
      inherit: true,
      rules: [],
      colors: {
        'editor.background': solid(c.surface),
        'editorGutter.background': solid(c.surface),
        'editor.lineHighlightBackground': solid(c['surface-2']),
        'editorLineNumber.foreground': `${solid(c['text-muted'])}99`,
        'editorLineNumber.activeForeground': solid(c['text-muted']),
        'editor.selectionBackground': `${solid(c.accent)}40`,
        'editorWidget.background': solid(c['surface-2']),
        'editorWidget.border': solid(c.border),
      },
    });
  }
}

defineThemes(currentPalette());
// Cores trocadas em Configurações valem na hora também nos editores abertos.
onPaletteChange((palette) => {
  defineThemes(palette);
  monaco.editor.setTheme(dark.matches ? 'nexus-dark' : 'nexus-light');
});

/** Tema do Monaco acompanhando o tema do app (que o main aplica no prefers-color-scheme). */
export function useMonacoTheme(): 'nexus-dark' | 'nexus-light' {
  const query = '(prefers-color-scheme: dark)';
  const [dark, setDark] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setDark(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return dark ? 'nexus-dark' : 'nexus-light';
}

export const monacoOptions = {
  fontFamily: "'Cascadia Code', Consolas, monospace",
  fontSize: 13,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  automaticLayout: true,
  wordWrap: 'off' as const,
  renderWhitespace: 'selection' as const,
};
