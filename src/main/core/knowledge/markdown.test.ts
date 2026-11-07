import { describe, expect, it } from 'vitest';
import { sanitizeFileName } from '../../fs/filename';
import { parseNote, splitFrontmatter } from './markdown';

describe('parseNote', () => {
  it('lê título, resumo, tags e links de uma nota no formato do Obsidian', () => {
    const note = parseNote(
      [
        '---',
        'tags: [trabalho, processo]',
        'aliases: [Fechamento]',
        '---',
        '# Fechamento Mensal',
        '',
        'Rotina de **fechamento** do mês, ligada à [[Conciliação Bancária]] e ao [[Sistemas/HYLIAN|HYLIAN]].',
        '',
        '- Conferir [[Notas Fiscais#Entrada]] #urgente',
        '- Ver ![[diagrama.png]]',
        '',
        '```',
        '#naoetag [[NaoELink]]',
        '```',
      ].join('\n'),
      'Fechamento Mensal.md',
    );
    expect(note.title).toBe('Fechamento Mensal');
    expect(note.summary).toBe('Rotina de fechamento do mês, ligada à Conciliação Bancária e ao HYLIAN.');
    expect(note.tags.sort()).toEqual(['trabalho', 'processo', 'urgente'].sort());
    expect(note.aliases).toEqual(['Fechamento']);
    expect(note.links.map((l) => l.target)).toEqual([
      'Conciliação Bancária',
      'Sistemas/HYLIAN',
      'Notas Fiscais',
      'diagrama.png',
    ]);
  });

  it('usa o nome do arquivo quando não há título e o frontmatter quando há resumo', () => {
    expect(parseNote('texto solto', 'Ideias.md')).toMatchObject({ title: 'Ideias', summary: 'texto solto' });
    expect(parseNote('---\ntitle: Outro\nsummary: Curto.\n---\n# H\n\ncorpo', 'x.md')).toMatchObject({
      title: 'Outro',
      summary: 'Curto.',
    });
  });

  it('não confunde título markdown nem cor hexadecimal com tag', () => {
    expect(parseNote('# Título\n\nCor #ff0000 e #2026 e #tag-válida', 'a.md').tags).toEqual(['ff0000', 'tag-válida']);
  });

  it('resume textos longos', () => {
    expect(parseNote('a'.repeat(300), 'a.md').summary.length).toBe(140);
  });

  it('frontmatter inválido é ignorado', () => {
    expect(splitFrontmatter('---\n: : :\n  - [\n---\ncorpo')).toEqual({ data: {}, body: 'corpo' });
  });
});

describe('sanitizeFileName', () => {
  it('mantém acentos e espaços e remove o que o Windows não aceita', () => {
    expect(sanitizeFileName('Conciliação Bancária')).toBe('Conciliação Bancária');
    expect(sanitizeFileName('Relatório: Q3/2026? <final>')).toBe('Relatório Q3 2026 final');
    expect(sanitizeFileName('  ..nota.  ')).toBe('nota');
    expect(sanitizeFileName('CON')).toBe('CON_');
    expect(sanitizeFileName('///')).toBeNull();
  });
});
