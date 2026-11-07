import type { DatabaseSync } from 'node:sqlite';

export interface ProjectRow {
  id: string;
  workspaceId: string;
  name: string;
  kind: 'linked' | 'managed';
  path: string;
  instructions: string;
  trustedFingerprint: string | null;
  createdAt: string;
  updatedAt: string;
}

const columns = `id, workspace_id AS workspaceId, name, kind, path, instructions,
  trusted_fingerprint AS trustedFingerprint, created_at AS createdAt, updated_at AS updatedAt`;

export class ProjectsRepo {
  constructor(private readonly db: DatabaseSync) {}

  listByWorkspace(workspaceId: string): ProjectRow[] {
    return this.db
      .prepare(
        `SELECT ${columns} FROM projects WHERE workspace_id = ? AND archived_at IS NULL
         ORDER BY sort_order, created_at, id`,
      )
      .all(workspaceId) as unknown as ProjectRow[];
  }

  find(id: string): ProjectRow | undefined {
    return this.db.prepare(`SELECT ${columns} FROM projects WHERE id = ? AND archived_at IS NULL`).get(id) as
      ProjectRow | undefined;
  }

  insert(row: ProjectRow): void {
    this.db
      .prepare(
        `INSERT INTO projects (id, workspace_id, name, kind, path, instructions, trusted_fingerprint, created_at, updated_at, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?,
           (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM projects WHERE workspace_id = ?))`,
      )
      .run(
        row.id,
        row.workspaceId,
        row.name,
        row.kind,
        row.path,
        row.instructions,
        row.trustedFingerprint,
        row.createdAt,
        row.updatedAt,
        row.workspaceId,
      );
  }

  /** Grava a ordem escolhida: a posição na lista vira o `sort_order` (tudo ou nada). */
  setOrder(ids: string[]): void {
    const update = this.db.prepare('UPDATE projects SET sort_order = ? WHERE id = ?');
    this.db.exec('BEGIN');
    try {
      ids.forEach((id, index) => update.run(index, id));
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  setInstructions(id: string, instructions: string, at: string): void {
    this.db.prepare('UPDATE projects SET instructions = ?, updated_at = ? WHERE id = ?').run(instructions, at, id);
  }

  setTrustedFingerprint(id: string, fingerprint: string | null, at: string): void {
    this.db
      .prepare('UPDATE projects SET trusted_fingerprint = ?, updated_at = ? WHERE id = ?')
      .run(fingerprint, at, id);
  }

  archive(id: string, at: string): void {
    this.db.prepare('UPDATE projects SET archived_at = ?, updated_at = ? WHERE id = ?').run(at, at, id);
  }
}
