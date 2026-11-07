import type { DatabaseSync } from 'node:sqlite';
import { activitySchema, type ChatMessage, attachmentSchema } from '@shared/chat';
import type { FileChange } from '@shared/code';
import { z } from 'zod';

export interface ConversationRow {
  id: string;
  workspaceId: string;
  projectId: string | null;
  title: string;
  cwd: string;
  claudeSessionId: string | null;
  model: string | null;
  effort: string | null;
  createdAt: string;
  updatedAt: string;
  /** Conversa de origem, quando esta é uma continuação. */
  forkedFrom?: string | null;
}

const conversationColumns = `id, workspace_id AS workspaceId, project_id AS projectId, title, cwd, claude_session_id AS claudeSessionId, model, effort,
  created_at AS createdAt, updated_at AS updatedAt, forked_from AS forkedFrom`;

interface MessageRow {
  id: string;
  conversationId: string;
  seq: number;
  role: 'user' | 'assistant';
  content: string;
  status: ChatMessage['status'];
  error: string | null;
  activities: string;
  attachments: string;
  usage: string | null;
  undoneAt: string | null;
  model: string | null;
  createdAt: string;
}

const usageSchema = z.object({ inputTokens: z.number(), outputTokens: z.number() });

export class ConversationsRepo {
  constructor(private readonly db: DatabaseSync) {}

  insertConversation(row: ConversationRow): void {
    this.db
      .prepare(
        `INSERT INTO conversations
           (id, workspace_id, project_id, title, cwd, claude_session_id, model, effort, created_at, updated_at, forked_from)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.workspaceId,
        row.projectId,
        row.title,
        row.cwd,
        row.claudeSessionId,
        row.model,
        row.effort,
        row.createdAt,
        row.updatedAt,
        row.forkedFrom ?? null,
      );
  }

  /** Continuação mais recente (não arquivada) feita a partir de uma conversa. */
  findContinuationOf(sourceId: string): ConversationRow | undefined {
    return this.db
      .prepare(
        `SELECT ${conversationColumns} FROM conversations
         WHERE forked_from = ? AND archived_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .get(sourceId) as ConversationRow | undefined;
  }

  /** `projectId`: `null` = só as conversas gerais do Workspace; ausente = todas. */
  listByWorkspace(workspaceId: string, projectId?: string | null): ConversationRow[] {
    const scope = projectId === undefined ? '' : projectId === null ? 'AND project_id IS NULL' : 'AND project_id = ?';
    const args = projectId ? [workspaceId, projectId] : [workspaceId];
    return this.db
      .prepare(
        `SELECT ${conversationColumns} FROM conversations
         WHERE workspace_id = ? AND archived_at IS NULL ${scope} ORDER BY updated_at DESC, rowid DESC`,
      )
      .all(...args) as unknown as ConversationRow[];
  }

  /** Conversa (não arquivada) que já usa esta sessão do Claude Code. */
  findBySessionId(sessionId: string): ConversationRow | undefined {
    return this.db
      .prepare(`SELECT ${conversationColumns} FROM conversations WHERE claude_session_id = ? AND archived_at IS NULL`)
      .get(sessionId) as ConversationRow | undefined;
  }

  findConversation(id: string): ConversationRow | undefined {
    return this.db
      .prepare(`SELECT ${conversationColumns} FROM conversations WHERE id = ? AND archived_at IS NULL`)
      .get(id) as ConversationRow | undefined;
  }

  setSessionId(id: string, sessionId: string): void {
    this.db.prepare('UPDATE conversations SET claude_session_id = ? WHERE id = ?').run(sessionId, id);
  }

  setModel(id: string, model: string | null, effort: string | null): void {
    this.db.prepare('UPDATE conversations SET model = ?, effort = ? WHERE id = ?').run(model, effort, id);
  }

  touch(id: string, at: string): void {
    this.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(at, id);
  }

  archive(id: string, at: string): void {
    this.db.prepare('UPDATE conversations SET archived_at = ? WHERE id = ?').run(at, id);
  }

  /** Insere a mensagem com o próximo número de sequência da conversa. */
  insertMessage(
    message: Omit<ChatMessage, 'seq' | 'undoneAt' | 'attachments'> & { attachments?: ChatMessage['attachments'] },
  ): ChatMessage {
    const { next } = this.db
      .prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM messages WHERE conversation_id = ?')
      .get(message.conversationId) as { next: number };
    this.db
      .prepare(
        `INSERT INTO messages (id, conversation_id, seq, role, content, status, error, activities, attachments, usage, model, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.id,
        message.conversationId,
        next,
        message.role,
        message.content,
        message.status,
        message.error,
        JSON.stringify(message.activities),
        JSON.stringify(message.attachments ?? []),
        message.usage ? JSON.stringify(message.usage) : null,
        message.model,
        message.createdAt,
      );
    return { ...message, attachments: message.attachments ?? [], seq: next, undoneAt: null };
  }

  insertFileChanges(messageId: string, changes: FileChange[]): void {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO file_changes (message_id, path, kind, before, after, truncated) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const c of changes) stmt.run(messageId, c.path, c.kind, c.before, c.after, c.truncated ? 1 : 0);
  }

  /** Ids dos anexos que aparecem em mensagens das conversas do Workspace. */
  listAttachmentIds(workspaceId: string): Set<string> {
    const rows = this.db
      .prepare(
        `SELECT m.attachments AS attachments FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE c.workspace_id = ? AND m.attachments <> '[]'`,
      )
      .all(workspaceId) as Array<{ attachments: string }>;
    const ids = new Set<string>();
    for (const r of rows) for (const a of parseJson(r.attachments, z.array(attachmentSchema)) ?? []) ids.add(a.id);
    return ids;
  }

  listFileChanges(messageId: string): FileChange[] {
    const rows = this.db
      .prepare('SELECT path, kind, before, after, truncated FROM file_changes WHERE message_id = ? ORDER BY rowid')
      .all(messageId) as Array<Omit<FileChange, 'truncated'> & { truncated: number }>;
    return rows.map((r) => ({ ...r, truncated: r.truncated === 1 }));
  }

  markUndone(messageId: string, at: string): void {
    this.db.prepare('UPDATE messages SET undone_at = ? WHERE id = ?').run(at, messageId);
  }

  listMessages(conversationId: string): ChatMessage[] {
    const rows = this.db
      .prepare(
        `SELECT id, conversation_id AS conversationId, seq, role, content, status, error, activities, attachments, usage,
           undone_at AS undoneAt, model, created_at AS createdAt
         FROM messages WHERE conversation_id = ? ORDER BY seq`,
      )
      .all(conversationId) as unknown as MessageRow[];
    return rows.map((r) => ({
      ...r,
      activities: parseJson(r.activities, z.array(activitySchema)) ?? [],
      attachments: parseJson(r.attachments, z.array(attachmentSchema)) ?? [],
      usage: r.usage ? (parseJson(r.usage, usageSchema) ?? null) : null,
    }));
  }
}

function parseJson<T>(text: string, schema: z.ZodType<T>): T | undefined {
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
