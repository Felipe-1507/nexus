import fs from 'node:fs';
import path from 'node:path';
import { NexusError } from '@shared/ipc-result';
import type { NoteTreeNode } from '@shared/knowledge';
import { writeFileAtomic } from '../../fs/atomic';
import { sanitizeFileName } from '../../fs/filename';
import { isInside, resolveInsideReal } from '../../fs/safe-path';

/** Tamanho máximo de uma nota editada pelo Nexus. */
export const NOTE_MAX_BYTES = 2 * 1024 * 1024;
export const TRASH_DIR = '.trash';

export interface NoteFile {
  /** Caminho relativo ao vault, sempre com `/`. */
  path: string;
  mtimeMs: number;
}

/**
 * Pasta de notas de um Workspace, no formato do Obsidian. Toda operação recebe caminhos relativos (com `/`) e
 * confere duas vezes que o destino fica dentro do vault: lexicalmente (`..`, caminho absoluto, outra unidade) e
 * pelo caminho real no disco (links simbólicos e junctions que apontem para fora).
 * Pastas e arquivos ocultos (`.obsidian`, `.git`, `.trash`) e links não aparecem nem são seguidos.
 */
export class Vault {
  constructor(
    readonly root: string,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  ensure(): void {
    fs.mkdirSync(this.root, { recursive: true });
  }

  tree(): NoteTreeNode {
    this.ensure();
    const walk = (dir: string, rel: string): NoteTreeNode[] => {
      const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => !e.name.startsWith('.'));
      const folders = entries
        .filter((e) => e.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
        .map((e): NoteTreeNode => {
          const childRel = rel ? `${rel}/${e.name}` : e.name;
          return { type: 'folder', name: e.name, path: childRel, children: walk(path.join(dir, e.name), childRel) };
        });
      const notes = entries
        .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md'))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
        .map((e): NoteTreeNode => ({
          type: 'note',
          name: e.name.replace(/\.md$/i, ''),
          path: rel ? `${rel}/${e.name}` : e.name,
        }));
      return [...folders, ...notes];
    };
    return { type: 'folder', name: '', path: '', children: walk(this.root, '') };
  }

  /**
   * Todas as notas, com o mtime. Os caminhos saem da própria varredura do `tree()`, que lê as entradas da pasta e não
   * segue links nem junctions (eles não são arquivo nem pasta comuns). Por isso aqui não se repete a conferência
   * pelo caminho real a cada arquivo, que custava ~2 ms por nota.
   */
  listNotes(): NoteFile[] {
    const out: NoteFile[] = [];
    const visit = (nodes: NoteTreeNode[]) => {
      for (const n of nodes) {
        if (n.type === 'folder') visit(n.children ?? []);
        else out.push({ path: n.path, mtimeMs: Math.floor(fs.statSync(this.listedFile(n.path)).mtimeMs) });
      }
    };
    visit(this.tree().children ?? []);
    return out;
  }

  /** Conteúdo de uma nota vinda de `listNotes()` (mesma garantia, sem a conferência por arquivo). */
  readListed(rel: string): Promise<string> {
    return fs.promises.readFile(this.listedFile(rel), 'utf8');
  }

  private listedFile(rel: string): string {
    return path.join(this.root, ...rel.split('/'));
  }

  read(rel: string): { content: string; mtimeMs: number } {
    const file = this.noteFile(rel);
    try {
      return { content: fs.readFileSync(file, 'utf8'), mtimeMs: Math.floor(fs.statSync(file).mtimeMs) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new NexusError('NOT_FOUND', 'Nota não encontrada.');
      throw err;
    }
  }

  /** Grava só se a nota não mudou desde que foi lida (o Claude ou o Obsidian podem tê-la alterado). */
  write(rel: string, content: string, expectedMtimeMs: number): { mtimeMs: number } {
    if (Buffer.byteLength(content, 'utf8') > NOTE_MAX_BYTES) {
      throw new NexusError('VALIDATION', 'A nota passa do limite de 2 MB.');
    }
    const file = this.noteFile(rel);
    const current = fs.existsSync(file) ? Math.floor(fs.statSync(file).mtimeMs) : 0;
    if (current !== expectedMtimeMs) {
      throw new NexusError('CONFLICT', 'A nota foi alterada fora do editor. Recarregue para ver a versão atual.');
    }
    writeFileAtomic(file, content);
    return { mtimeMs: Math.floor(fs.statSync(file).mtimeMs) };
  }

  /** Cria uma nota com nome válido (sem repetir um existente) e devolve o caminho dela. */
  create(folderRel: string, title: string): string {
    const name = sanitizeFileName(title);
    if (!name) throw new NexusError('VALIDATION', 'Dê um nome à nota.');
    const folder = this.folder(folderRel);
    const fileName = this.uniqueName(folder, name, '.md');
    writeFileAtomic(path.join(folder, fileName), `# ${title.trim()}\n\n`);
    return this.toRel(path.join(folder, fileName));
  }

  createFolder(parentRel: string, title: string): string {
    const name = sanitizeFileName(title);
    if (!name) throw new NexusError('VALIDATION', 'Dê um nome à pasta.');
    const parent = this.folder(parentRel);
    const target = path.join(parent, name);
    if (fs.existsSync(target)) throw new NexusError('VALIDATION', `Já existe "${name}" nesta pasta.`);
    fs.mkdirSync(target);
    return this.toRel(target);
  }

  /** Renomeia nota ou pasta, sem mudar de lugar. */
  rename(rel: string, title: string): string {
    const source = this.existing(rel);
    const name = sanitizeFileName(title);
    if (!name) throw new NexusError('VALIDATION', 'Dê um nome válido.');
    const isNote = fs.statSync(source).isFile();
    const target = path.join(path.dirname(source), isNote ? `${name}.md` : name);
    if (target.toLowerCase() !== source.toLowerCase() && fs.existsSync(target)) {
      throw new NexusError('VALIDATION', `Já existe "${name}" nesta pasta.`);
    }
    fs.renameSync(source, target);
    return this.toRel(target);
  }

  move(rel: string, targetFolderRel: string): string {
    const source = this.existing(rel);
    const folder = this.folder(targetFolderRel);
    if (fs.statSync(source).isDirectory() && isInside(source, folder, source, this.platform)) {
      throw new NexusError('VALIDATION', 'Uma pasta não pode ir para dentro dela mesma.');
    }
    const target = path.join(folder, path.basename(source));
    if (fs.existsSync(target)) throw new NexusError('VALIDATION', `Já existe "${path.basename(source)}" no destino.`);
    fs.renameSync(source, target);
    return this.toRel(target);
  }

  /** Manda para a lixeira do vault (`.trash`, como o Obsidian). Nada é apagado de vez. */
  trash(rel: string): void {
    const source = this.existing(rel);
    if (source === path.resolve(this.root)) throw new NexusError('VALIDATION', 'Não é possível excluir o vault.');
    const trash = path.join(this.root, TRASH_DIR);
    fs.mkdirSync(trash, { recursive: true });
    const ext = path.extname(source);
    fs.renameSync(source, path.join(trash, this.uniqueName(trash, path.basename(source, ext), ext)));
  }

  /** Caminho absoluto, garantindo que fica dentro do vault mesmo seguindo links. */
  abs(rel: string): string {
    if (rel.split(/[\\/]/).some((part) => part.startsWith('.') && part !== '.')) {
      throw new NexusError('VALIDATION', 'Caminho inválido.');
    }
    const target = resolveInsideReal(this.root, rel, this.platform);
    if (!target) throw new NexusError('VALIDATION', 'Caminho fora da pasta de notas.');
    return target;
  }

  private noteFile(rel: string): string {
    if (!rel.toLowerCase().endsWith('.md')) throw new NexusError('VALIDATION', 'Só notas .md podem ser abertas aqui.');
    return this.abs(rel);
  }

  private folder(rel: string): string {
    this.ensure();
    const dir = rel ? this.abs(rel) : path.resolve(this.root);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory())
      throw new NexusError('NOT_FOUND', 'Pasta não encontrada.');
    return dir;
  }

  private existing(rel: string): string {
    if (!rel) throw new NexusError('VALIDATION', 'Caminho inválido.');
    const target = this.abs(rel);
    if (!fs.existsSync(target)) throw new NexusError('NOT_FOUND', 'Não encontrado.');
    return target;
  }

  private uniqueName(dir: string, base: string, ext: string): string {
    let candidate = `${base}${ext}`;
    for (let i = 1; fs.existsSync(path.join(dir, candidate)); i++) candidate = `${base} ${i}${ext}`;
    return candidate;
  }

  private toRel(abs: string): string {
    return path.relative(path.resolve(this.root), abs).split(path.sep).join('/');
  }
}
