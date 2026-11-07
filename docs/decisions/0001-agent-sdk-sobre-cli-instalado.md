# 0001: Claude Agent SDK sobre o CLI instalado

**Status:** aceita (2026-10-30)

## Contexto
O brief pede o Claude Code CLI oficial, sem usar a API diretamente. No modo não interativo (`claude -p`), porém, não existe prompt de permissão. Toda ação que exige aprovação precisa ser respondida por um "host" (`--permission-prompts host`). Caso contrário, é negada. O protocolo que faz essa ponte não é documentado e só tem implementação oficial no `@anthropic-ai/claude-agent-sdk`.

## Decisão
O processo main usa o **Claude Agent SDK** com `pathToClaudeCodeExecutable` apontando para o **CLI instalado** pelo usuário. Toda a integração fica atrás da interface `AgentEngine` (`src/main/agent/engine.ts`).

## Consequências
- O motor continua sendo o Claude Code. Autenticação, configurações, sessões e memória ficam no `~/.claude` da máquina, e cada máquina usa a sua própria conta sem nenhuma mudança no Nexus.
- O SDK não aumenta o consumo de tokens: a troca de mensagens com o processo é local.
- Ganhamos `canUseTool`, `interrupt()`, troca de modo e modelo e ferramentas MCP rodando dentro do app.
- Risco: incompatibilidade de versão entre o SDK e o CLI. Mitigação: a Etapa 0 valida a combinação, e o binário que vem com o SDK fica como plano B.
- O uso é pessoal, então não se aplica a restrição a produtos de terceiros que ofereçam o login do claude.ai.
- O pacote do SDK traz, como dependências opcionais por plataforma, um binário próprio do Claude Code (`@anthropic-ai/claude-agent-sdk-win32-x64`). O Nexus não o usa, porque sempre passa `pathToClaudeCodeExecutable`. Ele deve ficar fora do instalador (Etapa 10).
