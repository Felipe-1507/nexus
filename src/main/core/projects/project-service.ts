import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { SettingSource } from '@anthropic-ai/claude-agent-sdk';
import { NexusError } from '@shared/ipc-result';
import {
  PROJECT_INSTRUCTIONS_MAX,
  type ConfigTrust,
  type CreateProjectInput,
  type FolderInspection,
  type Project,
} from '@shared/project';
import { isInside } from '../../agent/permission-policy';
import { pathStatus } from '../../fs/path-status';
import { sameName, slugify } from '../../fs/slug';
import { ProjectsRepo, type ProjectRow } from '../../persistence/repositories/projects-repo';
import { PROJECTS_DIR, type WorkspaceService } from '../workspaces/workspace-service';
import { inspectProjectConfig } from './project-config';

export interface ProjectServiceDeps {
  db: DatabaseSync;
  workspaces: WorkspaceService;
  newId?: () => string;
  now?: () => string;
  platform?: NodeJS.Platform;
}

/** Como uma sessão do Claude Code deve rodar num projeto. */
export interface ProjectSessionSettings {
  project: Project;
  /** Sem confiança nas configurações do projeto, só as do usuário são carregadas. */
  settingSources: SettingSource[];
}

export class ProjectService {
  private readonly repo: ProjectsRepo;
  private readonly newId: () => string;
  private readonly now: () => string;
  private readonly platform: NodeJS.Platform;

  constructor(private readonly deps: ProjectServiceDeps) {
    this.repo = new ProjectsRepo(deps.db);
    this.newId = deps.newId ?? randomUUID;
    this.now = deps.now ?? (() => new Date().toISOString());
    this.platform = deps.platform ?? process.platform;
  }

  async list(workspaceId: string): Promise<Project[]> {
    this.deps.workspaces.get(workspaceId);
    return Promise.all(this.repo.listByWorkspace(workspaceId).map((r) => this.toProject(r)));
  }

  /** Grava a ordem dos projetos na barra lateral. `ids` precisa ser exatamente o conjunto de projetos do Workspace. */
  async reorder(workspaceId: string, ids: string[]): Promise<Project[]> {
    this.deps.workspaces.get(workspaceId);
    const current = this.repo.listByWorkspace(workspaceId).map((p) => p.id);
    if (ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every((id) => current.includes(id))) {
      throw new NexusError('VALIDATION', 'A lista de projetos mudou. Tente arrastar de novo.');
    }
    this.repo.setOrder(ids);
    return this.list(workspaceId);
  }

  async get(id: string): Promise<Project> {
    return this.toProject(this.require(id));
  }

  /** Examina uma pasta antes de vincular: existe, é pasta, tem configurações que executam código? */
  async inspectFolder(workspaceId: string, rawPath: string): Promise<FolderInspection> {
    this.deps.workspaces.get(workspaceId);
    const target = path.resolve(rawPath.trim());
    const { status, isDirectory } = await pathStatus(target);
    const risks = status === 'ok' && isDirectory ? (await inspectProjectConfig(target)).risks : [];
    return {
      path: target,
      status,
      isDirectory,
      suggestedName: path.basename(target) || target,
      configRisks: risks,
      alreadyLinked: this.repo.listByWorkspace(workspaceId).some((p) => this.samePath(p.path, target)),
    };
  }

  async create(input: CreateProjectInput): Promise<Project> {
    const workspace = this.deps.workspaces.get(input.workspaceId);
    const existing = this.repo.listByWorkspace(workspace.id);
    if (existing.some((p) => sameName(p.name, input.name))) {
      throw new NexusError('VALIDATION', `Já existe um projeto chamado "${input.name}" neste Workspace.`);
    }
    const id = this.newId();
    const now = this.now();
    const row: ProjectRow = {
      id,
      workspaceId: workspace.id,
      name: input.name,
      kind: input.kind,
      path: '',
      instructions: '',
      trustedFingerprint: null,
      createdAt: now,
      updatedAt: now,
    };

    if (input.kind === 'managed') {
      row.path = path.join(
        workspace.rootPath,
        PROJECTS_DIR,
        `${slugify(input.name)}-${id.replace(/-/g, '').slice(0, 4)}`,
      );
      fs.mkdirSync(row.path, { recursive: true });
    } else {
      const inspection = await this.inspectFolder(workspace.id, input.path);
      if (inspection.status === 'unavailable') {
        throw new NexusError('VALIDATION', 'A pasta não respondeu. Verifique se o servidor está acessível.');
      }
      if (inspection.status === 'missing' || !inspection.isDirectory) {
        throw new NexusError('VALIDATION', 'Pasta não encontrada.');
      }
      if (inspection.alreadyLinked)
        throw new NexusError('VALIDATION', 'Esta pasta já está vinculada a este Workspace.');
      // Isolamento: a pasta de outro Workspace não pode virar projeto deste.
      const owner = this.deps.workspaces
        .list()
        .find((w) => w.id !== workspace.id && isInside(w.rootPath, inspection.path, w.rootPath, this.platform));
      if (owner) throw new NexusError('VALIDATION', `Esta pasta pertence ao Workspace "${owner.name}".`);
      row.path = inspection.path;
      if (input.trustConfig) row.trustedFingerprint = (await inspectProjectConfig(row.path)).fingerprint;
    }

    this.repo.insert(row);
    return this.toProject(row);
  }

  async setInstructions(id: string, instructions: string): Promise<Project> {
    this.require(id);
    if (Buffer.byteLength(instructions, 'utf8') > PROJECT_INSTRUCTIONS_MAX) {
      throw new NexusError('VALIDATION', `As instruções passam do limite de ${PROJECT_INSTRUCTIONS_MAX / 1024} KB.`);
    }
    this.repo.setInstructions(id, instructions, this.now());
    return this.get(id);
  }

  /** O usuário aceita as configurações atuais do projeto (registra a impressão digital delas). */
  async trustConfig(id: string): Promise<Project> {
    const row = this.require(id);
    const { fingerprint } = await inspectProjectConfig(row.path);
    this.repo.setTrustedFingerprint(id, fingerprint, this.now());
    return this.get(id);
  }

  /** Para de confiar nas configurações do projeto. */
  async revokeTrust(id: string): Promise<Project> {
    this.require(id);
    this.repo.setTrustedFingerprint(id, null, this.now());
    return this.get(id);
  }

  archive(id: string): void {
    this.require(id);
    this.repo.archive(id, this.now());
  }

  async sessionSettings(id: string): Promise<ProjectSessionSettings> {
    const project = await this.get(id);
    if (project.status === 'unavailable') {
      throw new NexusError('VALIDATION', `A pasta do projeto não respondeu: ${project.path}`);
    }
    if (project.status === 'missing')
      throw new NexusError('VALIDATION', `Pasta do projeto não encontrada: ${project.path}`);
    const loadProjectConfig = project.configTrust === 'none' || project.configTrust === 'trusted';
    return { project, settingSources: loadProjectConfig ? ['user', 'project', 'local'] : ['user'] };
  }

  private async toProject(row: ProjectRow): Promise<Project> {
    const { status } = await pathStatus(row.path);
    let configTrust: ConfigTrust = 'none';
    let risks: string[] = [];
    if (status === 'ok') {
      const inspection = await inspectProjectConfig(row.path);
      risks = inspection.risks;
      if (risks.length > 0) {
        configTrust = !row.trustedFingerprint
          ? 'untrusted'
          : row.trustedFingerprint === inspection.fingerprint
            ? 'trusted'
            : 'changed';
      }
    }
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      name: row.name,
      kind: row.kind,
      path: row.path,
      instructions: row.instructions,
      status,
      configTrust,
      configRisks: risks,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private require(id: string): ProjectRow {
    const row = this.repo.find(id);
    if (!row) throw new NexusError('NOT_FOUND', 'Projeto não encontrado.');
    return row;
  }

  private samePath(a: string, b: string): boolean {
    return this.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  }
}
