# 0009: Marca configurável na hora de gerar o app

**Status:** aceita (2026-11-03) · ampliada na Etapa 11.2 (cores, logo e ícone)

## Contexto
O mesmo app precisa sair com nomes e visuais diferentes conforme onde é usado. Há o padrão, genérico, e uma marca própria para instalar em outros computadores. Manter duas cópias do código não compensa, e nome e cores não podem ficar espalhados em textos e valores fixos.

## Decisão
- **Marca padrão:**
  - nome "Nexus", `appId` `local.nexus.app`, sem autor;
  - cores de `src/shared/palette.ts`;
  - ícone genérico em `build/icon.png`, gerado de `build/icon.svg`.

  É o que o repositório gera sem nenhuma configuração.
- **Outra marca fica na pasta `branding.local/`**, na raiz do repositório e fora do git. Todos os arquivos são opcionais:

  | Arquivo | O que define |
  |---|---|
  | `branding.json` | `{ "productName": "Meu Nexus", "appId": "com.exemplo.meunexus", "author": "Meu nome" }` |
  | `theme.json` | cores: `{ "dark": { "bg": "#0a1020", "accent": "#4f8cff" }, "light": { … }, "galaxy": ["#…", …] }` |
  | `logo.svg` ou `logo.png` | logo da barra de título e da tela inicial (até 512 KB, embutida no app) |
  | `icon.png` | ícone do executável, do instalador e da janela (quadrado, com pelo menos 256×256) |

  - O `theme.json` aceita as mesmas chaves da paleta: `bg`, `surface`, `surface-2`, `titlebar`, `border`, `text`, `text-muted`, `accent`, `accent-soft`, `ok`, `danger`. Elas valem para o tema claro e para o escuro.
  - O que faltar vem do padrão. Chave desconhecida, cor fora de `#rrggbb`/`#rrggbbaa`, nome inválido para pasta do Windows, `appId` fora do formato ou ícone que não seja PNG quadrado de 256 ou mais **param o build com erro**.
  - Só o nome também pode vir de um arquivo `branding.local.json`.
- **Um só lugar lê a marca:** `scripts/branding.mjs`, usado pelo electron-vite, pelo electron-builder (`electron-builder.config.mjs`), pelo Vitest e pelos testes E2E.
  - No app, a marca vira a constante `BRAND` (`src/shared/brand.ts`), embutida na compilação.
  - `PALETTE` = cores padrão + trocas da marca.
- **Uma fonte de cores:**
  - **Interface:** o CSS das variáveis (`--bg`, `--accent`…) é gerado na compilação pelo módulo `virtual:nexus-theme.css`. Assim continua sendo CSS do próprio app, e o CSP não precisa de exceção.
  - **Processo main:** o fundo da janela e a barra de título nativa usam a mesma `PALETTE`.
  - **Outros:** o tema do Monaco e as cores dos sistemas da galáxia também usam a `PALETTE`.
- **O que a marca muda:**
  - nome do app, da janela e do executável, e o instalador `<Nome>-<versão>-instalador.exe`;
  - atalhos, `appId` (AppUserModelID) e autor, que aparece como organização do executável e editor em "Adicionar ou remover programas" (sem autor, vale o próprio nome do app);
  - cores, logo e ícone;
  - o texto que vai ao Claude ("dentro do <Nome>").
  - **As pastas de dados:** `%APPDATA%\<Nome>` e `%USERPROFILE%\<Nome>`. O main define o `userData` pela marca também em desenvolvimento, e respeita `--user-data-dir`.
- Nos textos corridos da interface, o app continua sendo chamado de "o Nexus", o que vale para qualquer marca.
- **O caminho do ícone vai só para o build de desenvolvimento** (ícone da janela). No pacote ele fica vazio: o app instalado usa o ícone do executável, e nenhum caminho da máquina de quem compilou entra no pacote.

## Consequências
- Duas marcas convivem no mesmo computador, cada uma com as próprias conversas, notas e configurações.
- Trocar a marca de uma instalação existente muda as pastas de dados. A outra marca começa do zero; não há migração automática.
- O `npm run dev`, os testes e o `npm run dist` usam a marca local sempre que ela existir. Os testes leem a marca do mesmo módulo, então continuam valendo com qualquer marca.
- Cores fixas na interface (hexadecimais soltos) furariam a marca. A regra está no `CLAUDE.md`.
- **Aparência escolhida pelo usuário (Etapa 11.3):**
  - Fica em cima da paleta da marca, em Configurações → Aparência: variação do tema escuro (`DARK_VARIANTS`: Padrão, Azul-noite, Grafite, Preto) e cor de destaque (prontas ou personalizada). No tema claro, o destaque fica 15% mais escuro, para manter o contraste do texto branco.
  - É gravada no `preferences.json` (`darkVariant`, `accent`) e validada no main.
  - Ao abrir, o main já põe as cores escolhidas num `<style id="nexus-appearance">` dentro da página que ele serve, então a primeira pintura sai certa, sem piscar a cor padrão. Quando a escolha muda, a interface atualiza esse mesmo `<style>`, o main atualiza o fundo e a barra de título da janela, e o Monaco redefine os temas.
