import type { DatabaseSync } from 'node:sqlite';
import type { PermissionMode } from '@shared/permissions';
import type { WorkspaceColor, WorkspaceIcon } from '@shared/workspace';

export interface WorkspaceRow {
  id: string;
  slug: string;
  name: string;
  color: WorkspaceColor;
  icon: WorkspaceIcon;
  rootPath: string;
  permissionMode: PermissionMode;
  defaultModel: string | null;
  defaultEffort: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

const columns = `id, slug, name, color, icon, root_path AS rootPath, permission_mode AS permissionMode, default_model AS defaultModel,
  default_effort AS defaultEffort, created_at AS createdAt,
  updated_at AS updatedAt, archived_at AS archivedAt`;

export class WorkspacesRepo {
  constructor(private readonly db: DatabaseSync) {}

  listActive(): WorkspaceRow[] {
    return this.db
      .prepare(`SELECT ${columns} FROM workspaces WHERE archived_at IS NULL ORDER BY created_at, rowid`)
      .all() as unknown as WorkspaceRow[];
  }

  findById(id: string): WorkspaceRow | undefined {
    return this.db.prepare(`SELECT ${columns} FROM workspaces WHERE id = ?`).get(id) as WorkspaceRow | undefined;
  }

  insert(row: Omit<WorkspaceRow, 'archivedAt'>): void {
    this.db
      .prepare(
        `INSERT INTO workspaces (id, slug, name, color, icon, root_path, permission_mode, default_model, default_effort, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.slug,
        row.name,
        row.color,
        row.icon,
        row.rootPath,
        row.permissionMode,
        row.defaultModel,
        row.defaultEffort,
        row.createdAt,
        row.updatedAt,
      );
  }

  update(id: string, patch: Pick<WorkspaceRow, 'name' | 'color' | 'icon' | 'updatedAt'>): void {
    this.db
      .prepare('UPDATE workspaces SET name = ?, color = ?, icon = ?, updated_at = ? WHERE id = ?')
      .run(patch.name, patch.color, patch.icon, patch.updatedAt, id);
  }

  setPermissionMode(id: string, mode: PermissionMode, at: string): void {
    this.db.prepare('UPDATE workspaces SET permission_mode = ?, updated_at = ? WHERE id = ?').run(mode, at, id);
  }

  setDefaultModel(id: string, model: string | null, effort: string | null, at: string): void {
    this.db
      .prepare('UPDATE workspaces SET default_model = ?, default_effort = ?, updated_at = ? WHERE id = ?')
      .run(model, effort, at, id);
  }

  archive(id: string, at: string): void {
    this.db.prepare('UPDATE workspaces SET archived_at = ?, updated_at = ? WHERE id = ?').run(at, at, id);
  }
}
