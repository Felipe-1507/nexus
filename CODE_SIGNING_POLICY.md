# Política de assinatura de código

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by
[SignPath Foundation](https://signpath.org/).

## O que é assinado

- Só o instalador do Nexus para Windows (`Nexus-<versão>-instalador.exe`), gerado pelo GitHub Actions a partir do
  código deste repositório ([.github/workflows/instalador.yml](.github/workflows/instalador.yml)).
- Nada é assinado a partir de um computador pessoal. Cada assinatura de versão publicada é aprovada à mão no SignPath.
- O instalador traz o Electron (MIT) e as bibliotecas listadas no `package.json`. O SDK do Claude Code
  (`@anthropic-ai/claude-agent-sdk`) é da Anthropic e segue os termos dela; o Claude Code em si não vem no
  instalador: o Nexus usa o que estiver instalado no computador.

## Equipe

| Papel | Quem |
|---|---|
| Autores e revisores (committers and reviewers) | Felipe Ferreira (Felipe-1507 no GitHub) |
| Aprovadores (approvers) | Felipe Ferreira (Felipe-1507 no GitHub) |

Todos usam autenticação em dois fatores no GitHub e no SignPath.

## Privacidade

Este programa não envia informação para outros sistemas da rede, a não ser quando a pessoa que o usa pede, ou quando
ela mesma o configura para isso:

- **Conversas com o Claude:** o que você escreve no chat (e as notas e arquivos que o Claude abrir para responder) vai
  para a Anthropic pelo Claude Code instalado no computador, com a sua conta. O Nexus não tem servidor próprio.
- **Tela de boas-vindas (opcional):** com a opção ligada, os títulos de commits, notas e conversas do período vão para
  o Claude, que os reescreve em uma ou duas frases. Dá para desligar em Configurações → Boas-vindas.
- **Versão do Claude Code:** o Nexus consulta o registro público do npm para saber se há versão nova do Claude Code.
- **Atualização do Nexus:** só se você configurar uma pasta ou endereço em Configurações → Atualizações.
- **Extensões (MCP e plugins):** conversam com os serviços que você mesmo configurar no Claude Code.

Não há telemetria, rastreamento nem anúncios. Conversas, notas e configurações ficam no seu computador.

---

## Code signing policy (English)

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by
[SignPath Foundation](https://signpath.org/).

- **Signed artifacts:** only the Windows installer (`Nexus-<version>-instalador.exe`), built by GitHub Actions from this
  repository's source. Release signing requests are manually approved in SignPath.
- **Committers and reviewers:** Felipe Ferreira (Felipe-1507 on GitHub).
- **Approvers:** Felipe Ferreira (Felipe-1507 on GitHub).
- **Privacy:** this program will not transfer any information to other networked systems unless specifically requested
  by the user or the person installing or operating it. Chat messages go to Anthropic through the user's own Claude Code
  installation and account; the optional welcome summary sends commit, note and conversation titles to Claude; the app
  checks the public npm registry for new Claude Code versions; app updates and MCP servers only contact locations the
  user configures. There is no telemetry.
