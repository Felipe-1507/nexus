import type { DatabaseSync } from 'node:sqlite';
import type { AuditEntry } from '@shared/permissions';

export interface RuleRow {
  id: string;
  workspaceId: string;
  tool: string;
  pattern: string;
  createdAt: string;
}

export class PermissionsRepo {
  constructor(private readonly db: DatabaseSync) {}

  listRules(workspaceId: string): RuleRow[] {
    return this.db
      .prepare(
        `SELECT id, workspace_id AS workspaceId, tool, pattern, created_at AS createdAt
         FROM permission_rules WHERE workspace_id = ? ORDER BY created_at, rowid`,
      )
      .all(workspaceId) as unknown as RuleRow[];
  }

  /** Cria a regra; se já existir igual, nada muda. */
  addRule(row: RuleRow): void {
    this.db
      .prepare(
        `INSERT INTO permission_rules (id, workspace_id, tool, pattern, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (workspace_id, tool, pattern) DO NOTHING`,
      )
      .run(row.id, row.workspaceId, row.tool, row.pattern, row.createdAt);
  }

  findRule(id: string): RuleRow | undefined {
    return this.db
      .prepare(
        'SELECT id, workspace_id AS workspaceId, tool, pattern, created_at AS createdAt FROM permission_rules WHERE id = ?',
      )
      .get(id) as RuleRow | undefined;
  }

  removeRule(id: string): void {
    this.db.prepare('DELETE FROM permission_rules WHERE id = ?').run(id);
  }

  audit(entry: Omit<AuditEntry, 'id'> & { workspaceId: string }): void {
    this.db
      .prepare(
        `INSERT INTO permission_audit
           (workspace_id, conversation_id, tool, summary, detail, decision, decided_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.workspaceId,
        entry.conversationId,
        entry.tool,
        entry.summary,
        entry.detail,
        entry.decision,
        entry.decidedBy,
        entry.createdAt,
      );
  }

  listAudit(workspaceId: string, limit = 50): AuditEntry[] {
    return this.db
      .prepare(
        `SELECT id, conversation_id AS conversationId, tool, summary, detail, decision, decided_by AS decidedBy,
           created_at AS createdAt
         FROM permission_audit WHERE workspace_id = ? ORDER BY id DESC LIMIT ?`,
      )
      .all(workspaceId, limit) as unknown as AuditEntry[];
  }
}
