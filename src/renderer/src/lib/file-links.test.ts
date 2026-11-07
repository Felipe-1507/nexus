import { describe, expect, it } from 'vitest';
import { fileTargetFromCode, fileTargetFromHref } from './file-links';

describe('links de arquivo nas respostas', () => {
  it('reconhece caminho do Windows, de rede, file:// e relativo como arquivo', () => {
    for (const href of [
      'C:\\Dev\\app\\a.ts',
      'C:/Dev/a.ts',
      '\\\\servidor\\c$\\nome\\x.txt',
      'file:///C:/Dev/a.ts',
      'src/app.ts',
      './a.md',
    ]) {
      expect(fileTargetFromHref(href)).toBe(href);
    }
  });

  it('endereço da web, e-mail, âncora, nota e esquemas perigosos não são arquivo', () => {
    for (const href of [
      'https://exemplo.com/a.pdf',
      'http://x',
      'mailto:a@b.com',
      '#secao',
      'nexus-note:Nota',
      'javascript:alert(1)',
      'data:text/html,x',
      '',
      undefined,
    ]) {
      expect(fileTargetFromHref(href as string)).toBeNull();
    }
  });

  it('código só vira link quando parece mesmo um arquivo', () => {
    for (const code of [
      'C:\\Dev\\app\\a.ts',
      'src/routes/cancelamentos.ts',
      'config.txt',
      'public/index.html:42',
      '../docs/ARQUITETURA.md',
      'logs/app.log',
      'Relatorio final.xlsx',
    ]) {
      expect(fileTargetFromCode(code)).toBe(code);
    }
    for (const code of [
      'npm run build',
      'console.log',
      'v1.2',
      'user.name',
      'a = b',
      'const x = 1;',
      'git status',
      'node_modules',
      'if (x) {\n}',
    ]) {
      expect(fileTargetFromCode(code)).toBeNull();
    }
  });
});
