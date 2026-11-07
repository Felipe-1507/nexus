-- Etapa 14: ordem dos projetos escolhida pelo usuário (arrastar) e modelo padrão Sonnet · Médio.
ALTER TABLE projects ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

-- A ordem de hoje (alfabética) vira o ponto de partida: nada muda de lugar até o usuário arrastar.
UPDATE projects SET sort_order = (
  SELECT COUNT(*) FROM projects p
  WHERE p.workspace_id = projects.workspace_id
    AND (p.name COLLATE NOCASE < projects.name COLLATE NOCASE
         OR (p.name COLLATE NOCASE = projects.name COLLATE NOCASE AND p.id < projects.id))
);

-- Workspaces que nunca escolheram modelo passam a usar Sonnet · Médio (quem já escolheu fica como está).
UPDATE workspaces SET default_model = 'sonnet', default_effort = 'medium'
WHERE default_model IS NULL AND default_effort IS NULL;
