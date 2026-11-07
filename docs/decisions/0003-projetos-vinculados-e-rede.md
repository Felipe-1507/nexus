# 0003: Projetos vinculados, gerenciados e em pastas de rede

**Status:** aceita (2026-10-30)

## Contexto
Os projetos reais ficam quase todos em pastas de rede (`\\servidor\...`). Hoje cada pasta tem as próprias conversas do Claude Code, com `CLAUDE.md` e memória automática presos ao caminho da pasta.

## Decisão
- Há dois tipos de projeto: **vinculado** (caminho existente, local ou UNC) e **gerenciado** (pasta criada dentro do Workspace).
- Uma conversa de projeto roda com `cwd` igual à pasta do projeto. Assim ela reaproveita automaticamente o `CLAUDE.md` e a memória que o Claude Code já tem daquela pasta.
- Ao vincular, o Nexus lista as sessões que já existem para aquele caminho e permite continuá-las.
- O projeto tem um ID próprio. Se a pasta mudar de lugar, basta apontar o novo caminho.
- Pastas de rede:
  - o watcher usa *polling*;
  - se o servidor estiver indisponível, o projeto aparece como "indisponível" e não gera erro fatal;
  - a validação de caminhos aceita UNC.
- Ao vincular uma pasta com hooks ou `.mcp.json`, o Nexus pede confirmação, porque em modo não interativo o CLI não mostra o diálogo de confiança.

## Implementação (Etapa 7)
- **Conversa de projeto:**
  - `cwd` é a pasta do projeto, e `additionalDirectories` são as notas do Workspace (`Conhecimentos/`);
  - o prompt traz as camadas instruções gerais → Workspace → projeto;
  - a política de permissões considera as duas pastas como "dentro".
- **Situação da pasta:** `pathStatus` com tempo limite de 3 s: `ok`, `missing` ou `unavailable`. O app não trava quando o servidor está fora do ar. Mensagens não são gravadas se a pasta não responde.
- **Confiança:** `inspectProjectConfig` lê `.claude/settings.json`, `.claude/settings.local.json` e `.mcp.json`, e aponta:
  - hooks;
  - `apiKeyHelper` e `statusLine`;
  - servidores MCP;
  - regras `permissions.allow`;
  - variáveis de ambiente;
  - JSON inválido.

  A confiança guarda o hash desses arquivos. Se eles mudarem, o estado vira `changed` e as configurações deixam de ser carregadas (`settingSources: ['user']`) até nova confirmação. Um projeto sem confiança roda sem as configurações e sem o `CLAUDE.md` da pasta.
- **Importar conversas:** `listSessions({ dir, includeWorktrees: false })`. Com `true`, a listagem levou 126 s numa pasta de rede (achado K). `getSessionMessages` é convertido por `convertTranscript`, que guarda as últimas 60 mensagens. A conversa importada continua a mesma sessão (`resume`).
- **Isolamento:** uma pasta dentro de outro Workspace não pode ser vinculada, e um projeto de um Workspace não pode ser usado a partir de outro. Os dois casos são testados, inclusive com o Claude real (palavra secreta).

## Consequências
- Cada projeto tem o seu "Claude especialista". A conversa geral do Workspace responde perguntas entre projetos usando as notas.
- A Etapa 0 precisa confirmar que o CLI funciona com `cwd` em caminho UNC.
