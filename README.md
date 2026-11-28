# Nexus

Aplicativo de mesa para Windows que junta, numa janela só:

- **Chat com o Claude Code**, com conversas organizadas por Workspace e projeto, anexos de imagem, fila de mensagens e controle do que o Claude pode fazer.
- **Segundo cérebro**: notas em Markdown (compatíveis com o Obsidian), com editor ao vivo, `[[links]]`, comandos com `/` e uma **Galáxia** que mostra as notas como planetas ligados entre si.
- **Código**: árvore de pastas dos projetos, visualizador, edição pequena e diff do que o Claude alterou. Dá para colar, soltar e excluir arquivos pela árvore.
- **Gerenciador de contexto**: mostra quanto cada conversa pesa e ajuda a continuar numa conversa nova sem perder o fio.

Suas notas e conversas ficam no seu computador. O que você manda no chat vai para a Anthropic pelo Claude Code instalado na sua máquina, com a sua própria conta. O Nexus não tem servidor próprio nem telemetria.

## Para usar

**Precisa de:** Windows 10 ou 11 e uma conta do Claude (plano Pro, Max ou equivalente).

1. Baixe e abra `Nexus-<versão>-instalador.exe`. Não pede administrador.
2. O instalador **não é assinado**, então o Windows pode mostrar "O Windows protegeu o computador". Clique em **Mais informações** e depois em **Executar assim mesmo**.
3. Na primeira abertura, leia o aviso de privacidade e confirme.
4. No chat, siga o passo a passo **"Conecte o Claude para conversar"**: o app instala o Claude Code (se faltar) e abre o login no navegador.
5. Crie um **Workspace** e comece a conversar.

Onde ficam os dados:

| O quê | Onde |
|---|---|
| Banco do app (conversas, ajustes) | `%APPDATA%\Nexus` |
| Notas e instruções dos Workspaces | `%USERPROFILE%\Nexus` |
| Sessões do Claude Code | `%USERPROFILE%\.claude` |

## Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by
[SignPath Foundation](https://signpath.org/).

Quem escreve, revisa e aprova as assinaturas, o que é assinado e o que o app envia pela rede:
[política de assinatura de código (code signing policy)](CODE_SIGNING_POLICY.md).

## Para desenvolver

Precisa de Git, Node.js 24 e o Claude Code instalado.

```
git clone https://github.com/Felipe-1507/nexus.git
cd nexus
npm install
npx install-electron      # o binário do Electron não vem com o npm install
npm run dev               # app em desenvolvimento
npm run check             # tipos, lint e testes unitários
npm run test:e2e          # testes de ponta a ponta (dados numa pasta temporária)
npm run dist              # gera o instalador em release\
```

Terminais abertos pelo VS Code ou pelo Claude Code podem herdar `ELECTRON_RUN_AS_NODE=1`; para o `npm run dev`, use um terminal limpo.

### Publicar uma versão assinada

O instalador é gerado e assinado pelo GitHub Actions ([.github/workflows/instalador.yml](.github/workflows/instalador.yml)):
suba a versão no `package.json`, faça o commit e crie a tag `vX.Y.Z`. O pedido de assinatura chega no SignPath para
ser aprovado, e o release sai com o instalador assinado e o `nexus-update.json`. Detalhes em
[ADR 0011](docs/decisions/0011-assinatura-signpath.md) e na [política de assinatura](CODE_SIGNING_POLICY.md).


Para mais detalhes:

- [PROJECT_BRIEF.md](PROJECT_BRIEF.md): visão do produto.
- [docs/ARQUITETURA.md](docs/ARQUITETURA.md): arquitetura e etapas.
- [docs/decisions/](docs/decisions/): decisões técnicas.
- [CLAUDE.md](CLAUDE.md): regras de trabalho para quem (ou o que) for mexer no código.
- Outra marca (nome, cores, logo e ícone): veja `scripts/branding.mjs` e [ADR 0009](docs/decisions/0009-marca-configuravel.md).

## Autor

Desenvolvido por Felipe Ferreira · [felipeferreira.dev](https://felipeferreira.dev) · [GitHub](https://github.com/Felipe-1507)

## Licença

MIT. Veja o arquivo [LICENSE](LICENSE).
