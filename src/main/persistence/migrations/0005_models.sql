-- Etapa 6.1: escolha de modelo e esforço. NULL = herdar (conversa → Workspace → padrão do Claude Code).
ALTER TABLE workspaces ADD COLUMN default_model TEXT;
ALTER TABLE workspaces ADD COLUMN default_effort TEXT;
ALTER TABLE conversations ADD COLUMN model TEXT;
ALTER TABLE conversations ADD COLUMN effort TEXT;
-- Modelo que de fato respondeu (informado pelo Claude Code no início da sessão).
ALTER TABLE messages ADD COLUMN model TEXT;
