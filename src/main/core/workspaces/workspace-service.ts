import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { NexusError } from '@shared/ipc-result';
import { DEFAULT_EFFORT, DEFAULT_MODEL, effortSchema, type ModelChoice } from '@shared/models';
import { permissionModeSchema, type PermissionMode } from '@shared/permissions';
import {
  INSTRUCTIONS_MAX_BYTES,
  type CreateWorkspaceInput,
  type Instructions,
  type UpdateWorkspaceInput,
  type Workspace,
} from '@shared/workspace';
import { writeFileAtomic } from '../../fs/atomic';
import { sameName, slugify } from '../../fs/slug';
import { SettingsRepo } from '../../persistence/repositories/settings-repo';
import { WorkspacesRepo, type WorkspaceRow } from '../../persistence/repositories/workspaces-repo';

const ACTIVE_KEY = 'workspaces.activeId';
export const INSTRUCTIONS_FILE = 'workspace.md';
export const KNOWLEDGE_DIR = 'Conhecimentos';
export const PROJECTS_DIR = 'Projetos';
export const META_DIR = '.nexus';

export interface WorkspaceServiceDeps {
  db: DatabaseSync;
  /** Pasta raiz de conteúdo (ex.: C:\Users\<usuário>\Nexus). */
  dataRoot: string;
  newId?: () => string;
  now?: () => string;
}

export class WorkspaceService {
  private readonly repo: WorkspacesRepo;
  private readonly settings: SettingsRepo;
  private readonly newId: () => string;
  private readonly now: () => string;

  constructor(private readonly deps: WorkspaceServiceDeps) {
    this.repo = new WorkspacesRepo(deps.db);
    this.settings = new SettingsRepo(deps.db);
    this.newId = deps.newId ?? randomUUID;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  get workspacesDir(): string {
    return path.join(this.deps.dataRoot, 'workspaces');
  }

  list(): Workspace[] {
    return this.repo.listActive().map(toWorkspace);
  }

  get(id: string): Workspace {
    return toWorkspace(this.requireActive(id));
  }

  /** Cria a pasta com a estrutura padrão e registra no banco. Se algo falhar, nada fica pela metade. */
  create(input: CreateWorkspaceInput): Workspace {
    this.ensureUniqueName(input.name);
    const id = this.newId();
    const slug = `${slugify(input.name)}-${id.replace(/-/g, '').slice(0, 4)}`;
    const rootPath = path.join(this.workspacesDir, slug);
    if (fs.existsSync(rootPath)) throw new NexusError('CONFLICT', `Já existe uma pasta em ${rootPath}`);

    const now = this.now();
    const row: WorkspaceRow = {
      id,
      slug,
      name: input.name,
      color: input.color,
      icon: input.icon,
      rootPath,
      permissionMode: 'auto',
      defaultModel: DEFAULT_MODEL,
      defaultEffort: DEFAULT_EFFORT,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };
    fs.mkdirSync(this.workspacesDir, { recursive: true });
    try {
      fs.mkdirSync(rootPath);
      for (const dir of [KNOWLEDGE_DIR, PROJECTS_DIR, META_DIR]) fs.mkdirSync(path.join(rootPath, dir));
      fs.writeFileSync(path.join(rootPath, INSTRUCTIONS_FILE), `# Instruções: ${input.name}\n\n`, 'utf8');
      writeMeta(row);
      this.repo.insert(row);
    } catch (err) {
      fs.rmSync(rootPath, { recursive: true, force: true });
      throw err;
    }
    this.settings.set(ACTIVE_KEY, id);
    return toWorkspace(row);
  }

  /** Atualiza nome, cor e ícone. A pasta não é renomeada, porque caminhos e sessões dependem dela. */
  update(input: UpdateWorkspaceInput): Workspace {
    const current = this.requireActive(input.id);
    if (input.name !== undefined && !sameName(input.name, current.name)) this.ensureUniqueName(input.name, current.id);
    const next: WorkspaceRow = {
      ...current,
      name: input.name ?? current.name,
      color: input.color ?? current.color,
      icon: input.icon ?? current.icon,
      updatedAt: this.now(),
    };
    this.repo.update(next.id, next);
    if (fs.existsSync(next.rootPath)) writeMeta(next);
    return toWorkspace(next);
  }

  /** Tira o Workspace da lista. Os arquivos continuam no disco. */
  setPermissionMode(id: string, mode: PermissionMode): Workspace {
    this.requireActive(id);
    this.repo.setPermissionMode(id, mode, this.now());
    return this.get(id);
  }

  setDefaultModel(id: string, choice: ModelChoice): Workspace {
    this.requireActive(id);
    this.repo.setDefaultModel(id, choice.model, choice.effort, this.now());
    return this.get(id);
  }

  archive(id: string): void {
    this.requireActive(id);
    this.repo.archive(id, this.now());
    if (this.settings.get(ACTIVE_KEY, z.string()) === id) {
      const next = this.repo.listActive()[0];
      if (next) this.settings.set(ACTIVE_KEY, next.id);
      else this.settings.delete(ACTIVE_KEY);
    }
  }

  /** Workspace ativo. Se o salvo não existir mais, cai no primeiro da lista. */
  getActiveId(): string | null {
    const saved = this.settings.get(ACTIVE_KEY, z.string());
    if (saved && this.repo.findById(saved)?.archivedAt === null) return saved;
    return this.repo.listActive()[0]?.id ?? null;
  }

  setActive(id: string): void {
    this.requireActive(id);
    this.settings.set(ACTIVE_KEY, id);
  }

  readInstructions(id: string): Instructions {
    const file = this.instructionsFile(id);
    try {
      const stat = fs.statSync(file);
      return { content: fs.readFileSync(file, 'utf8'), mtimeMs: Math.floor(stat.mtimeMs) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { content: '', mtimeMs: 0 };
      throw err;
    }
  }

  /**
   * Grava o workspace.md só se ele não mudou desde que o editor o leu (outro editor, o Obsidian ou o próprio
   * Claude podem ter alterado). Assim nenhuma alteração alheia é sobrescrita em silêncio.
   */
  saveInstructions(id: string, content: string, expectedMtimeMs: number): { mtimeMs: number } {
    if (Buffer.byteLength(content, 'utf8') > INSTRUCTIONS_MAX_BYTES) {
      throw new NexusError('VALIDATION', `As instruções passam do limite de ${INSTRUCTIONS_MAX_BYTES / 1024} KB.`);
    }
    const file = this.instructionsFile(id);
    const currentMtime = fs.existsSync(file) ? Math.floor(fs.statSync(file).mtimeMs) : 0;
    if (currentMtime !== expectedMtimeMs) {
      throw new NexusError(
        'CONFLICT',
        'O arquivo de instruções foi alterado fora do editor. Recarregue para ver a versão atual.',
      );
    }
    writeFileAtomic(file, content);
    return { mtimeMs: Math.floor(fs.statSync(file).mtimeMs) };
  }

  private instructionsFile(id: string): string {
    const ws = this.requireActive(id);
    if (!fs.existsSync(ws.rootPath)) {
      throw new NexusError('NOT_FOUND', `A pasta do Workspace não foi encontrada: ${ws.rootPath}`);
    }
    return path.join(ws.rootPath, INSTRUCTIONS_FILE);
  }

  private requireActive(id: string): WorkspaceRow {
    const row = this.repo.findById(id);
    if (!row || row.archivedAt !== null) throw new NexusError('NOT_FOUND', 'Workspace não encontrado.');
    return row;
  }

  private ensureUniqueName(name: string, exceptId?: string): void {
    if (this.repo.listActive().some((w) => w.id !== exceptId && sameName(w.name, name))) {
      throw new NexusError('VALIDATION', `Já existe um Workspace chamado "${name.trim()}".`);
    }
  }
}

function toWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    color: row.color,
    icon: row.icon,
    rootPath: row.rootPath,
    knowledgeDir: path.join(row.rootPath, KNOWLEDGE_DIR),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    folderStatus: fs.existsSync(row.rootPath) ? 'ok' : 'missing',
    // Valor desconhecido no banco cai no padrão seguro do produto (Auto).
    permissionMode: permissionModeSchema.catch('auto').parse(row.permissionMode),
    defaultModel: row.defaultModel,
    defaultEffort: effortSchema.nullable().catch(null).parse(row.defaultEffort),
  };
}

/** Cópia dos metadados dentro da própria pasta, para reconstruir o banco se ele se perder. */
function writeMeta(row: WorkspaceRow): void {
  const meta = { version: 1, id: row.id, name: row.name, color: row.color, icon: row.icon, createdAt: row.createdAt };
  writeFileAtomic(path.join(row.rootPath, META_DIR, 'workspace.json'), JSON.stringify(meta, null, 2));
}
