-- Conversas: cada uma pertence a um Workspace, roda numa pasta (cwd) e corresponde a uma sessão do Claude Code.
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id),
  title TEXT NOT NULL,
  cwd TEXT NOT NULL,
  claude_session_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE INDEX conversations_by_workspace ON conversations (workspace_id, archived_at, updated_at);

-- Mensagens como o Nexus as exibe. A transcrição completa (para o modelo) continua com o Claude Code.
-- Para mensagens do usuário, o id é o mesmo uuid enviado ao Claude Code (usado pelo "Desfazer").
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('complete', 'interrupted', 'error')),
  error TEXT,
  activities TEXT NOT NULL DEFAULT '[]',
  usage TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (conversation_id, seq)
);
