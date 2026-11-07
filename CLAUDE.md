# Nexus

Aplicativo desktop (Electron) de uso pessoal: segundo cérebro em Markdown + chat com o Claude Code + visualização de código.

- Visão do produto: [PROJECT_BRIEF.md](PROJECT_BRIEF.md)
- Arquitetura, revisões do brief e plano de etapas: [docs/ARQUITETURA.md](docs/ARQUITETURA.md). Leia antes de qualquer mudança estrutural.
- Decisões técnicas: [docs/decisions/](docs/decisions/). Toda mudança relevante de direção ganha um ADR novo.

## Comandos
- `npm run dev`: app em modo desenvolvimento (Vite + Electron).
- `npm run check`: tipos, lint e testes unitários (Vitest). Rodar antes de dar uma etapa por concluída.
- `npm run test:e2e`: compila e roda os testes Playwright contra o app real, com os dados numa pasta temporária (`NEXUS_USER_DATA_DIR`).
- `npm run dist`: gera o instalador NSIS em `release/` ([ADR 0008](docs/decisions/0008-instalador-e-empacotamento.md)). O nome do app vem da marca: "Nexus" por padrão, ou a pasta `branding.local/`, que fica fora do git ([ADR 0009](docs/decisions/0009-marca-configuravel.md)).
- `npm run test:packaged`: gera o pacote e testa o `.exe` empacotado, com dados numa pasta temporária. A conversa real só roda com `NEXUS_LIVE_TESTS=1`. Antes de publicar uma versão, siga também o [roteiro manual](docs/ROTEIRO-INSTALADOR.md).
- O binário do Electron não vem com o `npm install`. Numa máquina nova, rode `npx install-electron`.
- Terminais abertos pelo VS Code ou pelo Claude Code podem herdar `ELECTRON_RUN_AS_NODE=1`, que faz o Electron rodar como Node puro. Os testes E2E removem essa variável; para o `npm run dev`, use um terminal limpo.

## Regras de trabalho
- Uma etapa por vez. Antes de implementar, explique brevemente o plano. Teste antes de avançar.
- O nome do app nunca é escrito fixo no código: use `BRAND.productName` (`src/shared/brand.ts`). Nos textos corridos, "o Nexus".
- Cores só pelas variáveis da paleta (`src/shared/palette.ts`, classes `bg-surface`, `text-accent`…), nunca hexadecimais soltos na interface.
- Identidade de outra marca (nome, logo, cores, ícone) vai só em `branding.local/`, fora do git. Ela nunca entra no código nem nos commits. Melhorias visuais genéricas valem para todas as marcas e vão no código normalmente.
- Interface, textos, documentação e mensagens de commit em pt-BR. Identificadores de código em inglês.
- Sem dados fictícios na interface. Estados vazios são reais.
- O renderer nunca acessa Node. Tudo passa por `src/shared/ipc-contract.ts`, validado com zod.
- Nunca usar `bypassPermissions` / `--dangerously-skip-permissions`.
- Testes que chamam o Claude Code de verdade só rodam com `NEXUS_LIVE_TESTS=1`, porque gastam a cota do plano.
- Para navegar ou fechar algo depois de uma mutation do TanStack Query, use `await mutateAsync(...)`, não callbacks de `mutate(..., { onSuccess })`. Se a lista recarregada remontar o componente, esses callbacks não são chamados.
- Testes E2E sempre usam `launchApp()` de `tests/e2e/launch.ts`, que isola o userData e a pasta de conteúdo numa pasta temporária. Por padrão ele simula "Claude Code não instalado" (`NEXUS_CLAUDE_CLI` apontando para um caminho inexistente); use `{ claude: 'real' }` só em testes com `NEXUS_LIVE_TESTS=1`.
- Testes reais do chat: `NEXUS_LIVE_TESTS=1 npx playwright test chat`. Eles usam `NEXUS_CLAUDE_MODEL=haiku` para gastar pouco. Para regravar as fixtures do normalizador: `node spikes/claude-sdk/capture-fixtures.mjs src/main/agent/__fixtures__`.
- `dependencies` só tem o que o processo main importa em tempo de execução. Bibliotecas da interface vão em `devDependencies`, porque saem dentro do bundle do renderer.
- Todo processo do Claude Code iniciado pelo Nexus recebe o ambiente de `childEnv()` (`src/main/agent/child-env.ts`) e é executado sem shell. A única exceção são as janelas visíveis de instalar e entrar (`src/main/agent/claude-setup.ts`): o Windows as abre por um lançador do PowerShell com texto fixo, e o caminho e os argumentos chegam por variáveis de ambiente. Os testes E2E simulam essas janelas (`NEXUS_SIMULATE_CONSOLE=1`).
