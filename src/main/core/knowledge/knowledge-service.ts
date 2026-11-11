import path from 'node:path';
import { NexusError } from '@shared/ipc-result';
import type { GalaxyGraph, KnowledgeEvent, Note, NoteLinks, NoteTreeNode } from '@shared/knowledge';
import type { WatchFn } from '../../fs/watcher';
import { KNOWLEDGE_DIR, type WorkspaceService } from '../workspaces/workspace-service';
import { buildIndex, type NoteIndex } from './note-index';
import { Vault } from './vault';

export interface KnowledgePrompt {
  dir: string;
  lines: string[];
  omitted: number;
}

interface Entry {
  vault: Vault;
  index: NoteIndex | null;
  /** Último índice montado, reaproveitado para reler só o que mudou. */
  previous: NoteIndex | null;
  /** Montagem em andamento, compartilhada por quem pedir o índice ao mesmo tempo. */
  building: Promise<NoteIndex> | null;
  /** Muda a cada alteração no vault: uma montagem que começou antes dela não vira o índice atual. */
  version: number;
  unwatch: (() => void) | null;
}

/** Arquivos que rodam ao serem abertos: o clique na lua só os mostra na pasta. */
const EXECUTABLE =
  /\.(exe|com|bat|cmd|ps1|psm1|psd1|vbs|vbe|js|jse|wsf|wsh|msi|msp|mst|scr|lnk|url|hta|cpl|jar|reg|pif|application|appref-ms|gadget|msc|scf|inf|sct|dll|sys|ws)$/i;

function markStale(entry: Entry): void {
  if (entry.index) entry.previous = entry.index;
  entry.index = null;
  entry.version++;
}

/**
 * O segundo cérebro de cada Workspace: a pasta `Conhecimentos/`, o índice das notas e a observação de mudanças.
 * Quem altera as notas (o Nexus, o Claude, o Obsidian) não importa: o watcher invalida o índice e avisa a tela.
 */
export class KnowledgeService {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly deps: {
      workspaces: WorkspaceService;
      emit: (event: KnowledgeEvent) => void;
      watch?: WatchFn;
      /** Abre um arquivo no programa padrão do Windows (devolve a mensagem de erro, ou '' se abriu). */
      open?: (file: string) => Promise<string>;
      /** Mostra o arquivo selecionado no Explorer. */
      reveal?: (file: string) => void;
    },
  ) {}

  dir(workspaceId: string): string {
    return path.join(this.deps.workspaces.get(workspaceId).rootPath, KNOWLEDGE_DIR);
  }

  tree(workspaceId: string): NoteTreeNode {
    return this.entry(workspaceId).vault.tree();
  }

  read(workspaceId: string, rel: string): Note {
    return { path: rel, ...this.entry(workspaceId).vault.read(rel) };
  }

  write(workspaceId: string, rel: string, content: string, expectedMtimeMs: number): { mtimeMs: number } {
    return this.mutate(workspaceId, [rel], (v) => v.write(rel, content, expectedMtimeMs));
  }

  create(workspaceId: string, folder: string, title: string): string {
    return this.mutate(workspaceId, [], (v) => v.create(folder, title));
  }

  createFolder(workspaceId: string, parent: string, title: string): string {
    return this.mutate(workspaceId, [], (v) => v.createFolder(parent, title));
  }

  rename(workspaceId: string, rel: string, title: string): string {
    return this.mutate(workspaceId, [rel], (v) => v.rename(rel, title));
  }

  move(workspaceId: string, rel: string, targetFolder: string): string {
    return this.mutate(workspaceId, [rel], (v) => v.move(rel, targetFolder));
  }

  trash(workspaceId: string, rel: string): void {
    this.mutate(workspaceId, [rel], (v) => v.trash(rel));
  }

  async links(workspaceId: string, rel: string): Promise<NoteLinks> {
    return (await this.index(workspaceId)).links(rel);
  }

  /** Resolve `[[alvo]]` citado na nota `from` para o caminho de uma nota (ou null). */
  async resolveLink(workspaceId: string, target: string, from?: string): Promise<string | null> {
    return (await this.index(workspaceId)).resolve(target, from);
  }

  /**
   * Abre (ou mostra na pasta) um arquivo incorporado na nota: a lua do planeta na galáxia. Programas e scripts não são
   * abertos, só mostrados na pasta: um anexo nunca é executado por um clique.
   */
  async openAttachment(workspaceId: string, note: string, name: string, reveal = false): Promise<void> {
    const file = this.entry(workspaceId).vault.findEmbed(name, note);
    if (!file) throw new NexusError('NOT_FOUND', `O anexo "${name}" não foi encontrado na pasta de notas.`);
    if (reveal || EXECUTABLE.test(file)) {
      if (!this.deps.reveal) throw new NexusError('INTERNAL', 'Não foi possível mostrar o anexo.');
      this.deps.reveal(file);
      return;
    }
    const error = this.deps.open ? await this.deps.open(file) : 'indisponível';
    if (error) throw new NexusError('INTERNAL', `Não foi possível abrir o anexo: ${error}`);
  }

  /** Descarta o índice para ser refeito no próximo uso (o watcher faz isso sozinho). */
  invalidate(workspaceId: string): void {
    const entry = this.entries.get(workspaceId);
    if (entry) markStale(entry);
  }

  index(workspaceId: string): Promise<NoteIndex> {
    const entry = this.entry(workspaceId);
    if (entry.index) return Promise.resolve(entry.index);
    if (!entry.building) {
      const version = entry.version;
      const build = buildIndex(entry.vault, entry.previous ?? undefined)
        .then((index) => {
          if (entry.version === version) entry.index = index;
          else entry.previous = index;
          return index;
        })
        .finally(() => {
          if (entry.building === build) entry.building = null;
        });
      entry.building = build;
    }
    return entry.building;
  }

  async graph(workspaceId: string): Promise<GalaxyGraph> {
    return (await this.index(workspaceId)).graph();
  }

  /** O que vai ao prompt do Claude: onde ficam as notas e o índice curto. */
  async promptSection(workspaceId: string): Promise<KnowledgePrompt> {
    const { lines, omitted } = (await this.index(workspaceId)).promptLines();
    return { dir: this.dir(workspaceId), lines, omitted };
  }

  close(): void {
    for (const entry of this.entries.values()) entry.unwatch?.();
    this.entries.clear();
  }

  private entry(workspaceId: string): Entry {
    const dir = this.dir(workspaceId);
    let entry = this.entries.get(workspaceId);
    if (!entry || entry.vault.root !== dir) {
      entry?.unwatch?.();
      entry = { vault: new Vault(dir), index: null, previous: null, building: null, version: 0, unwatch: null };
      entry.vault.ensure();
      const current = entry;
      current.unwatch =
        this.deps.watch?.(dir, (paths) => {
          markStale(current);
          this.deps.emit({ workspaceId, paths });
        }) ?? null;
      this.entries.set(workspaceId, entry);
    }
    return entry;
  }

  private mutate<T>(workspaceId: string, paths: string[], fn: (vault: Vault) => T): T {
    const entry = this.entry(workspaceId);
    const result = fn(entry.vault);
    markStale(entry);
    // O watcher também avisa; este aviso imediato deixa a tela em dia sem esperar o sistema de arquivos.
    this.deps.emit({ workspaceId, paths: typeof result === 'string' ? [...paths, result] : paths });
    return result;
  }
}
