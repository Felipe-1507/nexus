import fs from 'node:fs';

/** Grava via arquivo temporário + rename: quem lê nunca vê um arquivo pela metade. */
export function writeFileAtomic(file: string, content: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}
