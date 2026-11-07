import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { describe, expect, it } from 'vitest';
import { remarkNoteColors } from './remark-note-colors';

const render = (md: string) =>
  renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm, remarkNoteColors], children: md }));

describe('cores na visualização da nota', () => {
  it('pinta o trecho com a cor gravada no arquivo, inclusive com formatação dentro', () => {
    expect(render('um <span style="color:#e03e3e">trecho</span> aqui')).toContain(
      '<span style="color:#e03e3e">trecho</span>',
    );
    expect(render('<span style="color:#2e86c1">**forte**</span>')).toContain(
      '<span style="color:#2e86c1"><strong>forte</strong></span>',
    );
  });

  it('não renderiza HTML arbitrário nem estilos que o editor não grava', () => {
    expect(render('<span style="color:red;background:url(x)">x</span>')).not.toContain('<span');
    expect(render('<img src=x onerror=alert(1)> <b>oi</b>')).not.toContain('<img');
    expect(render('<span style="color:#e03e3e">sem fechar')).not.toContain('<span');
  });
});
