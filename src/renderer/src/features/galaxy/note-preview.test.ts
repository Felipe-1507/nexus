import { describe, expect, it } from 'vitest';
import { notePreview } from './note-preview';

describe('notePreview', () => {
  it('tira o frontmatter e o primeiro título (que o cartão já mostra)', () => {
    const md = '---\ntags: [a]\nresumo: x\n---\n# Título\n\nO texto da nota começa aqui.\n';
    expect(notePreview(md)).toBe('O texto da nota começa aqui.');
  });

  it('desfaz a marcação: links, wikilinks, negrito, listas, citações e imagens', () => {
    const md = [
      '# T',
      'Veja [[Bancos]] e [[Conta|a conta]] ou [site](https://x.com).',
      '- **item** um',
      '- [x] feito',
      '1. passo',
      '> citação',
      '![[foto.png]] ![alt](a.png)',
    ].join('\n');
    expect(notePreview(md)).toBe('Veja Bancos e a conta ou site. item um feito passo citação');
  });

  it('ignora blocos de código e linhas de separação', () => {
    const md = '# T\n\nAntes.\n```js\nconst x = 1;\n```\n---\nDepois.';
    expect(notePreview(md)).toBe('Antes. Depois.');
  });

  it('não corta no meio da palavra e põe reticências', () => {
    const md = `# T\n${'palavra '.repeat(100)}`;
    const p = notePreview(md, 50);
    expect(p.endsWith('…')).toBe(true);
    expect(p.length).toBeLessThanOrEqual(51);
    expect(p.slice(0, -1)).toMatch(/^(palavra ?)+$/);
  });

  it('nota vazia ou só com título devolve vazio', () => {
    expect(notePreview('')).toBe('');
    expect(notePreview('# Só título\n')).toBe('');
    expect(notePreview('---\na: 1\n---\n')).toBe('');
  });

  it('título que não é o primeiro conteúdo continua no texto', () => {
    expect(notePreview('Introdução solta.\n## Seção\nCorpo.')).toBe('Introdução solta. Seção Corpo.');
  });
});
