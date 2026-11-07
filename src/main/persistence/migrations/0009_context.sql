-- Medidor de contexto por conversa: a última medição (uma linha por conversa), vinda do uso real que o Claude Code
-- informa a cada turno ou, para conversas antigas, lida da transcrição dele. Nada aqui é estimado.
CREATE TABLE conversation_context (
  conversation_id TEXT PRIMARY KEY REFERENCES conversations (id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('live', 'reconstructed')),
  model TEXT,
  context_tokens INTEGER,
  input_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_creation_tokens INTEGER,
  window_tokens INTEGER,
  last_call_at TEXT,
  cache_rebuilt INTEGER,
  cost_usd REAL,
  prompt_hash TEXT,
  compaction_trigger TEXT,
  compaction_pre_tokens INTEGER,
  compaction_post_tokens INTEGER,
  compaction_duration_ms INTEGER,
  compaction_at TEXT,
  updated_at TEXT NOT NULL
);

-- Registro de cada compactação (a do "Continuar em nova conversa" e as automáticas do Claude Code).
CREATE TABLE compactions (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  source_conversation_id TEXT,
  trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'auto')),
  pre_tokens INTEGER NOT NULL,
  post_tokens INTEGER,
  duration_ms INTEGER,
  cost_usd REAL,
  created_at TEXT NOT NULL
);

CREATE INDEX compactions_by_conversation ON compactions (conversation_id, created_at);

-- Conversa de onde uma continuação saiu. A conversa de origem não é alterada.
ALTER TABLE conversations ADD COLUMN forked_from TEXT;
