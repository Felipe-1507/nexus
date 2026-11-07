-- Etapa 7: projetos (pastas vinculadas ou gerenciadas) dentro de um Workspace.
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id),
  name TEXT NOT NULL,
  -- linked: pasta existente (local ou de rede); managed: criada em <Workspace>/Projetos/.
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  -- Instruções do Nexus para este projeto (o CLAUDE.md do repositório continua valendo à parte).
  instructions TEXT NOT NULL DEFAULT '',
  -- Impressão digital das configurações do projeto (.claude/settings*.json, .mcp.json) que o usuário aceitou.
  -- NULL = não confiadas: a sessão não carrega as configurações do projeto.
  trusted_fingerprint TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE INDEX projects_by_workspace ON projects (workspace_id, archived_at);

ALTER TABLE conversations ADD COLUMN project_id TEXT REFERENCES projects (id);
