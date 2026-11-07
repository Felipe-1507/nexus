# 0008: Instalador NSIS por usuário, sem o Claude Code embutido

**Status:** aceita (2026-11-03)

## Contexto
A Etapa 10 fecha o MVP com um instalador que funcione num Windows sem nada configurado. Pontos em aberto:
- O SDK traz como dependência opcional uma cópia própria do Claude Code (`@anthropic-ai/claude-agent-sdk-win32-x64`, ~290 MB).
- As bibliotecas da interface (React, Monaco, CodeMirror) já saem compiladas no bundle do renderer, mas estavam em `dependencies` e seriam copiadas de novo para o pacote.
- Os fuses do Electron estavam previstos na seção 9 da arquitetura, mas não configurados.
- Com os fuses, o Playwright não consegue abrir o app empacotado do jeito normal (ele depende do `--inspect`).

## Decisão
- **electron-builder, alvo NSIS** (`electron-builder.config.mjs`). A instalação é **por usuário**, sem administrador, com pasta escolhível e atalhos na área de trabalho e no menu Iniciar. O instalador é em pt-BR. Desinstalar **não apaga** os dados (`%APPDATA%\<nome do app>` e a pasta de conteúdo).
- **O Claude Code do SDK fica fora do pacote.** O Nexus sempre passa `pathToClaudeCodeExecutable` com o CLI detectado na máquina (ADR 0001), então a cópia embutida nunca seria usada.
- **`dependencies` só tem o que o main carrega em tempo de execução**: SDK, chokidar, electron-log, yaml e zod. O resto foi para `devDependencies`, porque vai dentro do bundle.
- **Fuses:**
  - sem `RunAsNode`, `NODE_OPTIONS` nem `--inspect`;
  - verificação de integridade do ASAR;
  - app só carregado do ASAR;
  - cookies criptografados;
  - sem privilégios extras para `file://`.
- **Traduções do Chromium:** só pt-BR e en-US.
- **Sem assinatura de código** por enquanto (uso pessoal). O SmartScreen avisa na primeira instalação.
- **Teste do pacote** (`npm run test:packaged`):
  - abre o `.exe` com `--user-data-dir` numa pasta temporária e controla a página pela porta de depuração do Chromium;
  - confirma que a pasta isolada está em uso antes de qualquer ação;
  - a conversa de verdade só roda com `NEXUS_LIVE_TESTS=1`.

## Consequências
- Instalador com ~119 MB, quase tudo do próprio Electron. O ASAR tem ~38 MB.
- Uma máquina sem o Claude Code instalado mostra a orientação de instalação. Ela passou a indicar o instalador nativo (`irm https://claude.ai/install.ps1 | iex`), que não precisa do Node.js, e mantém o npm como alternativa.
- Atualizações do app são manuais: basta instalar a versão nova por cima. Atualização automática fica para depois do MVP.
- Uma dependência nova que o main importe precisa ir para `dependencies`. Se ficar em `devDependencies`, o app empacotado não abre, e o `npm run test:packaged` pega isso.
