import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { crc32, ZipWriter } from './zip-writer';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-zip-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** O `tar` do Windows (bsdtar) lê e extrai zip; é o verificador independente destes testes. */
const TAR = fs.existsSync('C:\\Windows\\System32\\tar.exe') ? 'C:\\Windows\\System32\\tar.exe' : 'tar';
const list = (zip: string) =>
  execFileSync(TAR, ['-tf', zip], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean).sort();
function extract(zip: string): string {
  const out = path.join(dir, 'extraido');
  fs.mkdirSync(out, { recursive: true });
  execFileSync(TAR, ['-xf', zip, '-C', out]);
  return out;
}

describe('crc32', () => {
  it('bate com o valor conhecido de "123456789"', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });
  it('pode ser calculado em partes', () => {
    expect(crc32(Buffer.from('6789'), crc32(Buffer.from('12345')))).toBe(0xcbf43926);
  });
});

describe('ZipWriter', () => {
  it('grava arquivos (inclusive grandes e com acento) que o extrator lê de volta idênticos', async () => {
    const big = Buffer.from('linha repetida de texto\n'.repeat(60_000));
    fs.writeFileSync(path.join(dir, 'grande.txt'), big);
    fs.writeFileSync(path.join(dir, 'vazio.txt'), '');
    const random = Buffer.from(Array.from({ length: 70_000 }, (_, i) => (i * 7919) % 251));
    fs.writeFileSync(path.join(dir, 'bin.dat'), random);

    const zip = new ZipWriter(path.join(dir, 'a.zip'));
    expect(await zip.addFile('pasta/grande.txt', path.join(dir, 'grande.txt'))).toBe(true);
    expect(await zip.addFile('vazio.txt', path.join(dir, 'vazio.txt'))).toBe(true);
    expect(await zip.addFile('bin/dados.dat', path.join(dir, 'bin.dat'))).toBe(true);
    await zip.addText('Nota é ç.md', '# Olá, mundo\n');
    await zip.finish();

    // (A listagem do tar sai na página de código do console, então o nome com acento se confere extraindo.)
    expect(list(path.join(dir, 'a.zip'))).toHaveLength(4);
    const out = extract(path.join(dir, 'a.zip'));
    expect(fs.readFileSync(path.join(out, 'pasta', 'grande.txt')).equals(big)).toBe(true);
    expect(fs.readFileSync(path.join(out, 'bin', 'dados.dat')).equals(random)).toBe(true);
    expect(fs.readFileSync(path.join(out, 'vazio.txt')).length).toBe(0);
    expect(fs.readFileSync(path.join(out, 'Nota é ç.md'), 'utf8')).toBe('# Olá, mundo\n');
  });

  it('com os limites no mínimo, usa zip64 nas entradas e no índice e ainda extrai igual', async () => {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'conteúdo A '.repeat(1000));
    fs.writeFileSync(path.join(dir, 'b.txt'), 'B');
    const zip = new ZipWriter(path.join(dir, 'z.zip'), { zip64Entry: 1, zip64Count: 1 });
    await zip.addFile('a.txt', path.join(dir, 'a.txt'));
    await zip.addFile('b.txt', path.join(dir, 'b.txt'));
    await zip.addText('c.txt', 'C');
    await zip.finish();
    expect(list(path.join(dir, 'z.zip'))).toEqual(['a.txt', 'b.txt', 'c.txt']);
    const out = extract(path.join(dir, 'z.zip'));
    expect(fs.readFileSync(path.join(out, 'a.txt'), 'utf8')).toBe('conteúdo A '.repeat(1000));
    expect(fs.readFileSync(path.join(out, 'b.txt'), 'utf8')).toBe('B');
    expect(fs.readFileSync(path.join(out, 'c.txt'), 'utf8')).toBe('C');
  });

  it('arquivo que não abre fica de fora sem estragar o zip', async () => {
    fs.writeFileSync(path.join(dir, 'ok.txt'), 'ok');
    const zip = new ZipWriter(path.join(dir, 'p.zip'));
    expect(await zip.addFile('some.txt', path.join(dir, 'nao-existe.txt'))).toBe(false);
    expect(await zip.addFile('ok.txt', path.join(dir, 'ok.txt'))).toBe(true);
    await zip.finish();
    expect(list(path.join(dir, 'p.zip'))).toEqual(['ok.txt']);
  });

  it('zip sem nenhuma entrada ainda é um zip válido', async () => {
    const zip = new ZipWriter(path.join(dir, 'v.zip'));
    await zip.finish();
    expect(fs.statSync(path.join(dir, 'v.zip')).size).toBe(22);
  });
});
