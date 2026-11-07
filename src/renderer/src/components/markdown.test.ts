import { describe, expect, it } from 'vitest';
import { prepareNoteMarkdown } from './Markdown';

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
