import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { hastText, Markdown, prepareNoteMarkdown } from './Markdown';

describe('prepareNoteMarkdown', () => {
  it('transforma wikilinks em links internos e tira o frontmatter', () => {
    expect(prepareNoteMarkdown('---\ntags: [a]\n---\nVer [[Conciliação Bancária]] e [[Sistemas/HYLIAN|o ERP]].')).toBe(
      'Ver [Conciliação Bancária](nexus-note:Concilia%C3%A7%C3%A3o%20Banc%C3%A1ria) e [o ERP](nexus-note:Sistemas%2FHYLIAN).',
    );
  });

  it('não mexe em código', () => {
    expect(prepareNoteMarkdown('`[[a]]` e\n```\n[[b]]\n```\n[[c]]')).toBe(
      '`[[a]]` e\n```\n[[b]]\n```\n[c](nexus-note:c)',
    );
  });
});

describe('bloco de código com botão de copiar', () => {
  it('cada bloco de código ganha o botão; código na linha não', () => {
    const html = renderToString(
      createElement(Markdown, null, 'Use `npm test` e rode:\n\n```js\nconst a = 1;\n```\n\n```\nsem linguagem\n```'),
    );
    expect(html.match(/data-testid="code-block"/g)).toHaveLength(2);
    expect(html.match(/aria-label="Copiar código"/g)).toHaveLength(2);
    expect(html).toContain('class="md-code-tools"');
  });

  it('hastText junta o texto do bloco, de qualquer profundidade', () => {
    const node = {
      type: 'element',
      children: [
        {
          type: 'element',
          children: [
            { type: 'text', value: 'const a = ' },
            { type: 'element', children: [{ type: 'text', value: '1;\n' }] },
          ],
        },
      ],
    };
    expect(hastText(node)).toBe('const a = 1;\n');
    expect(hastText(undefined)).toBe('');
  });
});
