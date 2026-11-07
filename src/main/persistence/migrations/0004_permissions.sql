-- Etapa 6: modo de permissão por Workspace, regras "sempre permitir", auditoria e "Desfazer".
-- Valores válidos de permission_mode: auto | ask | read_only (validados no código).
ALTER TABLE workspaces ADD COLUMN permission_mode TEXT NOT NULL DEFAULT 'auto';

CREATE TABLE permission_rules (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id),
  -- Ferramenta (Bash, WebFetch, mcp__…) ou "edit" para todas as ferramentas de edição de arquivos.
  tool TEXT NOT NULL,
  -- Para comandos: prefixo liberado ("npm test"). Vazio para liberar a ferramenta inteira.
  pattern TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (workspace_id, tool, pattern)
);

CREATE TABLE permission_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id),
  conversation_id TEXT,
  tool TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail TEXT,
  decision TEXT NOT NULL,
  decided_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX permission_audit_by_workspace ON permission_audit (workspace_id, id);

ALTER TABLE messages ADD COLUMN undone_at TEXT;
