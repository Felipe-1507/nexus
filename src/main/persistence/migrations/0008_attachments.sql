-- Etapa 12.3: arquivos anexados às mensagens do usuário (lista JSON de {id, name, mime, size}).
ALTER TABLE messages ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]';
