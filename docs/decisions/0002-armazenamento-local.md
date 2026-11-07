# 0002: Armazenamento local

**Status:** aceita (2026-10-30)

## Decisão
- **Metadados** (Workspaces, projetos, conversas, mensagens, regras, auditoria) ficam em SQLite, em `%APPDATA%\Nexus\nexus.db`, com migrações versionadas. O driver é o `node:sqlite` ([ADR 0007](0007-node-sqlite.md)).
- **Conteúdo** (instruções e notas) fica em Markdown, em `%USERPROFILE%\Nexus\workspaces\<slug>\` (ex.: `C:\Users\<usuário>\Nexus`). A pasta raiz é configurável, e cada vault pode apontar para uma pasta já existente.
  - Não usamos `Documentos` porque, nesta máquina, ela é sincronizada pelo OneDrive. Isso levaria dados de trabalho para a nuvem e poderia travar arquivos durante as gravações do Claude. Decisão do usuário em 2026-10-30.
- As pastas usam *slug* com ID curto. O nome exibido fica só nos metadados.
- As conversas **não** viram arquivos `.md`. A transcrição completa já existe no Claude Code. O Nexus guarda a versão normalizada para exibição e o `session_id`.
- O arquivo `.nexus/workspace.json` em cada Workspace guarda uma cópia dos metadados, para reconstruir o banco se ele for perdido.

## Consequências
- Renomear um Workspace não quebra caminhos nem sessões. Os nomes reservados do Windows ficam evitados.
- Os dados não sincronizam entre máquinas (MVP). Isso é desejado: dados de trabalho não vão para a máquina pessoal.
- Se o usuário apontar a pasta raiz ou um vault para dentro do OneDrive, o Nexus mostra um aviso.
