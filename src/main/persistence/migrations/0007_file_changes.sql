-- Etapa 9: antes e depois de cada arquivo alterado pelo Claude numa resposta (para o diff).
CREATE TABLE file_changes (
  message_id TEXT NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  kind TEXT NOT NULL,
  before TEXT,
  after TEXT,
  truncated INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (message_id, path)
);
