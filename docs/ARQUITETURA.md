# Nexus: arquitetura

**Status:** aprovada em 2026-10-30 · **Referência principal:** [`PROJECT_BRIEF.md`](../PROJECT_BRIEF.md)

Este documento registra as decisões técnicas do Nexus e as revisões feitas sobre o brief. Quando os dois divergirem, vale o que está aqui (seção 2). As decisões detalhadas ficam em [`docs/decisions/`](decisions/).

---

## 1. Visão em uma frase

**Meu Obsidian + Claude Code Chat + VS Code**, para uso pessoal. É um segundo cérebro em Markdown, mostrado como uma galáxia e mantido pelo próprio Claude, com um chat minimalista que trabalha nos projetos e uma visualização de código no estilo VS Code.

**Contexto de uso:**
- Só o próprio autor usa o Nexus; ele não será distribuído.
- Pode rodar em mais de uma máquina, cada uma com a própria conta Claude. As instalações não sincronizam entre si.
- A interface é só em pt-BR.
- Os projetos reais ficam quase todos em pastas de rede (`\\servidor\...`).

## 2. Revisões em relação ao brief

| Tema | Brief | Decisão | ADR |
|---|---|---|---|
| Integração | "Claude Code CLI oficial, sem API" | **Claude Agent SDK** controlando o **CLI instalado** (`pathToClaudeCodeExecutable`). Continua sendo o Claude Code, com a mesma autenticação, sessões e ferramentas. O SDK é a forma oficial de o app responder às permissões. | [0001](decisions/0001-agent-sdk-sobre-cli-instalado.md) |
| Projetos | Pasta `Workspaces/<nome>/Projetos/` | **Vinculados** (apontam para uma pasta existente, inclusive na rede) ou **gerenciados** (pasta criada dentro do Workspace) | [0003](decisions/0003-projetos-vinculados-e-rede.md) |
| Conversas | Pasta `Conversas/` em disco | Ficam no **SQLite**. A transcrição completa continua com o Claude Code (`~/.claude/projects`), e o Nexus guarda o `session_id` | [0002](decisions/0002-armazenamento-local.md) |
| Nomes de pasta | Nome do Workspace | *Slug* com ID curto (`trabalho-7f3a`). Assim é possível renomear sem quebrar nada e evitar nomes reservados do Windows | [0002](decisions/0002-armazenamento-local.md) |
| Permissões | Respeitar as permissões, sem `--dangerously-skip-permissions` | Modo por Workspace: **Auto** (padrão), Perguntar ou Somente leitura. **Nunca** `bypassPermissions`. Inclui "Desfazer" | [0004](decisions/0004-permissoes-modo-auto.md) |
| Chat | Não especificado | **Minimalista por padrão:** "Pensando…", depois a resposta final e os arquivos alterados. Os detalhes ficam recolhidos | [0005](decisions/0005-chat-minimalista.md) |
| Grafo | Futuro, sem prioridade | **Galáxia 3D**, logo depois do MVP. Os links entre notas já entram no MVP | [0006](decisions/0006-conhecimento-obsidian-e-galaxia.md) |
| Isolamento | "Separação real" | Isolamento de **contexto e permissão**, não um sandbox do sistema operacional. A interface deixa isso claro | — |
| Etapas | Começa pela fundação | Antes dela entra a **Etapa 0, um spike** que valida a integração (o maior risco do projeto) | — |

## 3. Visão geral dos processos

```text
┌─────────── Electron ────────────────────────────────────────────┐
│ Renderer (React, sandbox)  ⇄  preload (API mínima e tipada)      │
│                                   ⇅ IPC validado com zod         │
│ Main (Node)                                                       │
│   core/ (workspaces, projetos, conversas, conhecimento, contexto, │
│          permissões) · persistence/ (SQLite) · fs/ (caminhos)     │
│   agent/ ── SessionManager ── Claude Agent SDK                     │
└──────────────────────────────────│───────────────────────────────┘
                                   ▼ stdin/stdout (JSON, local, sem custo)
                     processo Claude Code (CLI instalado)
                        │                         │
                        ▼                         ▼
                 Anthropic (conta da máquina)   ~/.claude (login, configs, sessões, memória)
```

O renderer nunca tem acesso ao Node. Tudo o que é privilegiado roda no main e passa por um contrato IPC único (`src/shared/ipc-contract.ts`).

## 4. Integração com o Claude Code

- **Detecção:** procura o `claude` no PATH e em `~/.local/bin` e resolve o executável real (no Windows o npm instala um atalho `.cmd`). Valida com `claude --version`.
- **Autenticação:** usa `claude auth status --json`. O Nexus nunca lê nem guarda tokens. Na tela de status mostra a conta, o plano e a origem da autenticação (`apiKeySource`). O ambiente passado ao processo é limpo: sem `ANTHROPIC_API_KEY`, a não ser que essa seja a configuração escolhida.
- **Configuração herdada:** `settingSources: ['user', 'project', 'local']`, ou seja, o Nexus usa o `~/.claude/CLAUDE.md`, os hooks, os MCPs e os plugins do usuário. Há opção para desligar isso por Workspace.
- **Sessões:**
  - Uma conversa do Nexus corresponde a uma sessão do Claude Code, presa a um `cwd`, porque a transcrição é guardada por pasta.
  - Ao vincular um projeto, o Nexus lista as sessões que já existem para aquela pasta e permite continuá-las.
  - Regra: a mesma sessão não pode ser usada em dois lugares ao mesmo tempo.
- **Processo:**
  - Cada conversa ativa usa um processo em modo de entrada contínua, o que reduz a latência.
  - O processo é encerrado depois de um tempo ocioso e retomado com `resume`.
  - Ao fechar o app, `interrupt()` e o encerramento da árvore de processos garantem que nenhum processo fique órfão.
- **Streaming:**
  - `includePartialMessages`. O `event-normalizer` converte as mensagens do SDK em `ChatEvent`, o formato próprio do Nexus.
  - O envio para a interface é agrupado (~30 ms).
  - A gravação no banco acontece por mensagem completa, nunca por token.
- **Contexto:** `systemPrompt: { type: 'preset', preset: 'claude_code', append }`, com o texto montado pelo `context-composer` (seção 5).
  - Atenção: o *snapshot* de prompt do CLI congela esse texto na primeira mensagem da sessão. A forma de lidar com isso será definida na Etapa 0.
- **Confiança:** em modo não interativo o CLI não mostra o diálogo de confiança na pasta. Por isso, ao vincular uma pasta, o Nexus detecta `.claude/settings*.json` com hooks e `.mcp.json` e pede confirmação.

## 5. Modelo de domínio e contexto

```text
Global (configurações + instruções globais do Nexus)
└── Workspace ── workspace.md · Conhecimentos/ · configurações · modo de permissão · regras
    ├── Projeto (vinculado → caminho externo/UNC | gerenciado → Projetos/<slug>)
    ├── Conversa (1 Workspace, projeto opcional, 1 cwd, 1 sessão do Claude)
    └── Nota (.md em Conhecimentos/, ligada a projetos pela pasta ou por `projects:` no frontmatter)
```

| Conversa | `cwd` | `additionalDirectories` | Prompt acrescentado |
|---|---|---|---|
| Geral do Workspace | raiz do Workspace | — | Global + Workspace + índice de notas + regras de curadoria |
| De um Projeto | pasta do projeto | `Conhecimentos/` do Workspace | Global + Workspace + Projeto + índice de notas + regras de curadoria |

**Garantias de isolamento:**
- Uma conversa nunca recebe caminhos ou instruções de outro Workspace.
- As pastas de Workspaces diferentes nunca ficam uma dentro da outra.
- Teste obrigatório: uma palavra secreta colocada no Workspace A não pode aparecer no B.

**Tabelas (SQLite):**
- `workspaces`, `projects`, `conversations` (`claude_session_id`, `cwd`, `model`, `permission_mode`)
- `messages` (blocos em JSON e `seq`)
- `turns` (custo, uso de tokens, `stop_reason`, erro)
- `permission_rules`, `permission_audit`
- `file_changes` (Desfazer), `conversation_context` e `compactions` (contexto)
- O índice das notas é montado em memória a partir dos arquivos (não há `notes_index`); `notes_fts` (busca de texto) é futuro
- `settings`

## 6. Armazenamento

```text
%APPDATA%\Nexus\              ← app.getPath('userData')
├── nexus.db
├── preferences.json                ← o que é preciso antes do banco abrir (ex.: pasta raiz)
└── logs\
%USERPROFILE%\Nexus\          ← pasta raiz de conteúdo (configurável; fora do OneDrive)
└── workspaces\<slug>\
    ├── workspace.md                ← instruções do Workspace
    ├── Conhecimentos\              ← vault compatível com o Obsidian
    ├── Projetos\                   ← só projetos gerenciados
    └── .nexus\workspace.json       ← cópia dos metadados (permite reconstruir o banco)
```

Um Workspace pode apontar o seu vault para uma pasta já existente (por exemplo, um vault do Obsidian). Se a pasta escolhida estiver no OneDrive, o Nexus mostra um aviso, porque a sincronização pode travar arquivos e envia o conteúdo para a nuvem.

## 7. Segundo cérebro

- **Formato:** Markdown puro, frontmatter YAML, `[[wikilinks]]`, `#tags` e uma pasta de anexos. A mesma pasta abre no Obsidian.
- **O Claude é o curador:** o prompt traz as convenções do vault, e o Claude cria, atualiza e liga as notas sozinho.
  - Ele atualiza uma nota existente em vez de criar outra duplicada.
  - Ele sempre liga a nota nova às notas relacionadas.
  - No modo Auto, escrever no vault é liberado.
- **Consulta eficiente:**
  - O prompt recebe só um **índice curto** (caminho, título, tags e resumo de uma linha), e o Claude abre apenas a nota necessária.
  - No pós-MVP entram FTS5 e ferramentas MCP internas (`knowledge_search` e `knowledge_read`), limitadas ao Workspace.
- **Conhecimento de projeto:**
  - O `CLAUDE.md` no repositório guarda as regras técnicas e continua valendo no terminal e no VS Code.
  - A nota do projeto no vault guarda a visão geral, as decisões e as regras de negócio.
  - O Claude mantém as duas atualizadas.
- **Galáxia:** feita com Three.js.

  | No vault | Na galáxia |
  |---|---|
  | Workspace | Galáxia |
  | Pasta de primeiro nível do vault (as notas soltas formam o núcleo) | Sistema solar |
  | Nota | Planeta (tamanho conforme o número de conexões) |
  | `[[link]]` | Rota de luz |
  | Nota nova ou editada recentemente | Brilho |

  Abre em tela cheia (botão "Galáxia" na barra lateral), e clicar num planeta abre a nota no painel direito. Também abre como aba do painel direito, ao lado do chat: ali o clique só seleciona, e "Abrir nota" abre. Detalhes na [ADR 0006](decisions/0006-conhecimento-obsidian-e-galaxia.md).

## 8. Interface

- **Layout:**
  - **à esquerda:** Workspaces, projetos e árvore de notas;
  - **no centro:** o chat ou a galáxia;
  - **à direita:** painel com abas Nota, Código e Galáxia. A galáxia no painel fica ao lado do chat; em tela cheia, ela ocupa o centro.
- **Chat minimalista:**
  - Enquanto trabalha, mostra só "Pensando…".
  - No fim, mostra a resposta final (que aparece aos poucos) e cartões dos arquivos alterados, com o botão "Abrir".
  - O botão "Ver detalhes" mostra o histórico completo e o diff. O modo "Detalhado" fica nas configurações.
- **Notas:** editor CodeMirror 6 com visualização ao vivo e backlinks.
- **Código:** Monaco (o editor do VS Code) para visualizar e fazer pequenas edições, com diff do que o Claude mudou e um botão "Abrir no VS Code". Não é uma IDE completa.
- **Aparência:** temas claro e escuro, animações discretas e nenhum dado fictício (estados vazios de verdade).

## 9. Segurança

- **Janela do Electron:**
  - `contextIsolation`, `sandbox: true`, `nodeIntegration: false`;
  - CSP restritivo e nenhum conteúdo remoto;
  - navegação e abertura de novas janelas bloqueadas.
- **Links externos:** `shell.openExternal` só aceita https.
- **Fuses do Electron:** sem RunAsNode e com verificação de integridade do ASAR.
- **IPC:** lista fechada de canais. Toda chamada é validada com zod.
- **Caminhos:** `realpath` mais a verificação de que o caminho está dentro de uma pasta autorizada. Isso impede saídas por `..`, junctions e links simbólicos, e vale também para caminhos UNC.
- **Markdown:** renderizado sem HTML bruto.
- **Permissões:** nunca `bypassPermissions`. Toda decisão fica registrada em `permission_audit`. Um pedido sem resposta, ou com a janela fechada, é **negado**.
- **Tokens:** nenhum é armazenado. O aviso de privacidade aparece na primeira execução (o processamento é feito pela Anthropic).

## 10. Stack

| Camada | Tecnologia |
|---|---|
| Desktop | Electron, **electron-vite**, **electron-builder** (instalador NSIS) |
| Interface | React, TypeScript strict, Vite, Tailwind v4, shadcn/ui (Radix), Lucide |
| Estado | TanStack Query (dados do main) e Zustand (estado da interface) |
| Conteúdo | react-markdown, remark-gfm, **CodeMirror 6** (notas), **Monaco** (código), **Three.js** (galáxia) |
| Main | **Claude Agent SDK**, zod, **`node:sqlite`** com migrações SQL próprias ([ADR 0007](decisions/0007-node-sqlite.md)), chokidar (com *polling* para pastas de rede), electron-log |
| Testes | Vitest (unidade e integração), Playwright para Electron (ponta a ponta) |
| Pacotes | npm |

## 11. Estrutura do código

```text
src/
├── shared/      contratos entre processos: ipc-contract.ts, chat-events.ts, domain.ts
├── main/
│   ├── index.ts
│   ├── window/        criação da janela e segurança
│   ├── ipc/           handlers por domínio
│   ├── core/          workspaces/ projects/ conversations/ knowledge/ context/ permissions/
│   ├── agent/         cli-detector, auth-status, engine.ts, claude-sdk-engine, session-manager, event-normalizer
│   ├── persistence/   db, schema, migrations/, repositories/
│   ├── fs/            safe-path, vault-fs, watcher
│   └── platform/      caminhos, logs, encerramento de processos
├── preload/     contextBridge
└── renderer/src/
    ├── app/ · features/ (onboarding, workspaces, chat, knowledge, projects, code, galaxy, settings)
    ├── components/ui/ · lib/
tests/e2e/ · spikes/ · docs/
```

**Regras:**
- O renderer não importa nada de `main/`.
- Os serviços de `core/` não conhecem o Electron, o que permite testá-los com Vitest puro.
- Nenhum arquivo concentra lógica de domínios diferentes.

## 12. Plano de etapas

| # | Etapa | Pronto quando | Testes |
|---|---|---|---|
| 0 ✅ | **Spike de integração** | Todas as premissas da seção 13 confirmadas ou ajustadas, com os resultados em `spikes/claude-sdk/RESULTADOS.md` | Scripts rodados manualmente |
| 1 ✅ | Fundação | App abre; uma chamada IPC de teste funciona; banco criado com migração; CSP ativo | Vitest + Playwright (app abre) |
| 2 ✅ | Interface base | Três painéis, tema claro e escuro, navegação, estados vazios | Playwright |
| 3 ✅ | Workspaces | Criar, editar e alternar; pastas no disco; `workspace.md`; tudo persiste após reiniciar | Unidade (slug, nomes reservados, `..`) + E2E |
| 4 ✅ | Detecção do Claude Code | Tela de status real (instalado, versão, conta) com orientações quando algo falta | Unidade com chamadas simuladas + teste real opcional |
| 5 ✅ | Chat | Streaming no modo minimalista, conversas persistem, retomada após reiniciar, cancelar | Normalizador com fixtures de saída real + teste real opcional |
| 6 ✅ | Permissões e execução | Modos Auto, Perguntar e Somente leitura; diálogo de aprovação; comandos liberados; auditoria; "Desfazer" | Unidade do gerenciador de permissões + E2E real em pasta temporária |
| 6.1 ✅ | Seletor de modelo | Modelos da conta lidos do Claude Code (sem tokens), escolha por conversa, padrão por Workspace, esforço, modelo que respondeu em "Ver detalhes" | Unidade (catálogo, resolução conversa → Workspace → padrão) + E2E real |
| 7 ✅ | Contexto e Projetos | Montagem do contexto; projetos vinculados (incluindo UNC) e gerenciados; confiança; importar sessões existentes | **Teste de isolamento** + teste com pasta de rede |
| 8 ✅ | Segundo cérebro | Vault em árvore, editor, wikilinks e backlinks, watcher, índice no prompt, Claude como curador | Unidade de arquivos (tentativas de sair da pasta) + E2E |
| 9 ✅ | Visualizador de código | Monaco, árvore do projeto, diff das alterações, "Abrir no VS Code" | Unidade (caminhos, junction, escopo) + E2E + E2E real do diff |
| 10 | Refinamento e instalador ([ADR 0008](decisions/0008-instalador-e-empacotamento.md)) | Tratamento de erros, aviso de privacidade, instalador NSIS funcionando em um usuário sem nada configurado | Suíte completa + teste do pacote (`npm run test:packaged`) + [roteiro manual](ROTEIRO-INSTALADOR.md) |
| 10.1 | Conectar o Claude | Sem o Claude pronto, o chat mostra um passo a passo: "Instalar" (instalador oficial numa janela do PowerShell) e "Entrar com a minha conta" (`claude auth login`); o Nexus percebe sozinho quando cada passo termina. Notas e código funcionam sem o Claude | Unidade (comandos e lançador) + E2E com console simulado + teste real da janela |
| — | **MVP concluído** | Abrir → escolher Workspace ou projeto → conversar → trabalhar em arquivos → conhecimento persistente | — |
| 11 ✅ | Galáxia | Visualização 3D navegável, clicar abre a nota, busca leva a câmera até a nota | Unidade (grafo, disposição, busca, índice incremental) + E2E + teste de desempenho com 1.200 notas |
| 11.1 ✅ | Marca configurável ([ADR 0009](decisions/0009-marca-configuravel.md)) | Nome padrão "Nexus"; outra marca por `branding.local.json` (fora do git), com pastas de dados próprias | Unidade (validação da marca) + E2E e teste do pacote com a marca ativa |
| 11.2 ✅ | Cores, logo e ícone da marca | Paleta única (`src/shared/palette.ts`) para interface, janela, Monaco e galáxia; `branding.local/` com `theme.json`, logo e ícone; ícone padrão do Nexus | Unidade (paleta, validação do tema e do ícone) + E2E + teste do pacote com marca de teste |
| 11.3 ✅ | Aparência personalizável | Em Configurações: variações do tema escuro (Padrão, Azul-noite, Grafite, Preto) e cor de destaque (prontas ou personalizada), aplicadas na hora na interface, na janela e no Monaco, sem piscar ao abrir | Unidade (variações, destaque, mistura de cores) + E2E (troca, persistência, página já servida com as cores, valor inválido recusado) |
| 12.1 ✅ | Sinal de vida da resposta | "Ver detalhes" aparece embaixo do "Pensando…" com os passos ao vivo, há quanto tempo o Claude trabalha e há quanto tempo veio o último sinal (com aviso depois de 45 s sem novidades) | Unidade (relógio e último sinal) + E2E real |
| 12.2 ✅ | Fila de mensagens | Dá para enviar com o Claude respondendo: a mensagem espera a vez no main, aparece como "Na fila" (com botão para tirar) e começa sozinha quando a resposta atual termina, na ordem da conversa | Unidade (ordem, desistência, erro, isolamento) + E2E real |
| 12.3 ✅ | Anexos no chat | Colar (Ctrl+V), arrastar ou escolher imagens (PNG, JPG, GIF, WebP) e PDF, até 5 por mensagem e 20 MB cada. O tipo é conferido pelo conteúdo, o arquivo fica em `.nexus/anexos` do Workspace (fora do vault) e o Claude o abre com a ferramenta Read. Miniaturas no campo e na mensagem | Unidade (serviço de anexos, prompt, pastas permitidas, fila) + E2E (recusas) + E2E real (o Claude lê o texto de uma imagem colada) |
| 12.4 ✅ | Planetas com vida | Cada nota ganha um planeta sorteado e estável (rochoso, gasoso, oceano, gelo, lava ou deserto, com atmosfera e anéis), com textura calculada no shader. O tamanho cresce com as conexões e com o conteúdo da nota. O cartão do planeta edita tipo, cor, anéis, atmosfera, novo sorteio e uma anotação; o que foi trocado fica em `Conhecimentos/.planetas.json` | Unidade (aparência, tamanho, armazenamento) + E2E (edição, persistência, valor inválido) + desempenho com 1.200 notas |
| 12.5 ✅ | Uso do plano | Barra lateral com a sessão de 5 horas e a semana: % usado, hora do reinício e, se o ritmo mantiver, quando o limite acaba. Lido do Claude Code sem gastar tokens (~5 s, com cache de 1 min) e atualizado ao fim de cada resposta. Só para contas com assinatura. **Usa uma API que o SDK marca como experimental**: se uma versão nova do SDK mudar o formato, o medidor some em vez de quebrar o app | Unidade (tradução, cache, falhas, projeção, horários) + E2E real |
| 12.6 ✅ | Copiar e editar | Botão Copiar nas respostas do Claude e nas mensagens do usuário (copia pelo main, sem depender do foco da janela); Editar devolve o texto e os anexos ao campo para reenviar como mensagem nova (a antiga continua na conversa) | E2E real |
| 12.7 ✅ | Links de arquivo nas respostas | Link `[veja aqui](caminho)` ou caminho em código na resposta vira clicável: nota `.md` do vault abre na aba Nota, arquivo de texto do projeto na aba Código e o resto (planilha, PDF, imagem, pasta) no Explorer. Aceita caminho do Windows, de rede, `file://` e relativo, com `:linha` ou `#L12`. Só vale dentro das pastas do projeto e do Workspace; nunca executa nada | Unidade (limpeza do caminho, escopo, tipos) + E2E real |
| 12.8 ✅ | Limpeza de anexos | Ao abrir o app (depois de 30 s), apaga os anexos que nunca foram enviados e têm mais de 3 dias. Em Configurações → Anexos do chat: espaço usado e botão para apagar os de mais de 90 dias (inclusive de mensagens, que ficam sem a miniatura). Nunca apaga o anexo de uma mensagem na fila, nem arquivo que o Nexus não guardou (só nomes de id) | Unidade (regras de quem pode ser apagado) + E2E |
| 12.9 ✅ | Geral como visão de conjunto | A conversa geral do Workspace recebe, no prompt, a lista dos projetos (nome, pasta, primeira linha das instruções, aviso de pasta inacessível; até 40) e a orientação de manter no vault uma pasta de notas por projeto e a nota "Mapa dos sistemas". Escolher um projeto (ou o "Geral") abre direto a conversa mais recente dele, em vez de uma conversa em branco. As pastas dos projetos continuam fora das pastas liberadas do Geral: ler o código pede confirmação, e editar código de um projeto é para a conversa do próprio projeto | Unidade (prompt do Geral e do projeto, reabertura da sessão) + E2E real |
| 13 ✅ | Gerenciador de contexto | Medidor por conversa com dados reais do Claude Code (tokens do contexto, novos, cache lido e gravado, janela, modelo, última atividade, custo de lista), faixa discreta no topo da conversa com os detalhes ao clicar, avisos de contexto elevado, cache que pode ter expirado e prompt que mudou, painel geral **Sessões** (todas as conversas do Workspace, ordenável por contexto e por atividade) e limites configuráveis (50/75/90%). **Continuar em nova conversa** (sempre com confirmação): copia a sessão (`forkSession`), compacta só a cópia com o `/compact` nativo e mostra o resumo estruturado; a original fica intacta. Conversas antigas são lidas do fim da transcrição do Claude Code. Sem abrir sessão nem chamar a API para medir. [ADR 0010](decisions/0010-gerenciador-de-contexto.md) | Unidade (faixas, cache, serviço, leitura da transcrição, acumulador, fluxo de continuação com falhas, repetição e concorrência) + E2E (indicador, painel, limites, confirmação) + E2E real (medição conferida com a transcrição, reinício, fork + compactação, original idêntica por hash, conversa antiga reconstruída) |
| 13.1 ✅ | Sincronizar com o Claude Code | Botão no topo da conversa que traz para a tela o que a sessão ganhou fora do Nexus (VS Code, terminal). O Claude já lembra de tudo, porque a sessão é a mesma; isto só atualiza o histórico visível. Só acrescenta ao fim o que o Nexus ainda não tem (mensagens reconhecidas pelo id da transcrição, sem repetir as respostas que o próprio Nexus gravou), ignora o resumo e os comandos de compactação, nunca insere no meio e rodar de novo não acrescenta nada. Não altera a sessão | Unidade (seleção das mensagens novas e fluxo no serviço: importar, usar fora, usar no Nexus, repetir, recusas) + E2E + E2E real (conversa continuada por fora com `claude --resume`) |
| 14.1 ✅ | Ordem dos projetos e modelo padrão | Os projetos da barra lateral podem ser arrastados para a ordem preferida (ou movidos com Alt + seta); a ordem fica no banco (`projects.sort_order`), projetos novos entram no fim e a ordem alfabética antiga é o ponto de partida. Workspaces novos nascem com **Sonnet · Médio** como modelo padrão, e os que nunca escolheram um passam a usá-lo (quem já escolheu fica como está) | Unidade (ordem, recusa de lista inconsistente, migração 0010, modelo padrão) + E2E (arrastar, teclado, reiniciar, modelo do Workspace novo) |
| 14.2 ✅ | Pastas do projeto na barra lateral | Abaixo das conversas, a barra lateral mostra as pastas e arquivos do projeto escolhido (ou do Workspace, em Geral), com botão para abrir no VS Code. O painel de código deixou de listar arquivos: só mostra o arquivo que você clicou na árvore | E2E (seção abaixo das conversas, árvore, clique abre no painel, binário, edição e conflito) |
| 14.3 ✅ | Código na navegação e arranjo livre | **Código** vira uma tela própria entre Chat e Galáxia na barra lateral e só mostra um arquivo depois do clique na árvore de pastas. O centro pode ser Chat, Código ou Galáxia, e o painel direito oferece Nota mais as duas telas que não estão no centro (o chat só existe no centro). A aba preferida do painel volta sozinha quando a tela sai do centro; arquivos e diffs abrem no centro quando o Código está lá e no painel nos outros casos | Unidade (abas do painel) + E2E (ordem da navegação, abas por tela, arquivo no centro e no painel, volta ao chat) |
| 14.4 ✅ | Editor de notas estilo Notion | A edição da nota mostra o resultado ao vivo, como no Obsidian: títulos, **negrito**, listas, caixas de tarefa clicáveis, citações, divisores, `[[links]]`, #etiquetas e cores aparecem formatados fora do trecho onde está o cursor, e a marcação volta ao chegar nele. O arquivo continua sendo Markdown puro: nada é reescrito ao abrir, o frontmatter fica como texto e a cor de texto é gravada como `<span style="color:#rrggbb">` (o Obsidian também entende). Barra de formatação (títulos, negrito, itálico, tachado, código, cor, listas, tarefas, citação, link para nota) e menu de comandos ao digitar **/** (texto, títulos, listas, tarefas, citação, chamada, código, divisor, tabela, link para nota, cores). Enter continua a lista; Tab recua item. A visualização também mostra as cores (só neste formato exato). Imagens ficaram de fora, por decisão do usuário | Unidade (formatação, cores, numeração, cursor, visualização das cores e HTML bloqueado) + E2E (menu "/", listas, tarefas, clique na caixa, cor, negrito, ao vivo, frontmatter e arquivo intacto) |
| 14.5 ✅ | Colar, soltar e excluir na árvore de pastas | Como no Explorer do VS Code: copie arquivos ou pastas no Windows e cole na árvore do projeto (**Ctrl+V**, na pasta selecionada ou na raiz), ou arraste-os para cima de uma pasta. Nunca sobrescreve: nome repetido vira "nome - cópia". Excluir (lixeira ao passar o mouse ou tecla **Delete**) pede confirmação e manda para a **Lixeira do Windows**, nunca apaga de vez. O main só aceita destinos dentro da pasta do projeto, recusa a raiz, links simbólicos, pasta colada dentro dela mesma e as pastas do próprio app (banco e preferências) | Unidade (cópia, cópias repetidas, recusas, Lixeira) + E2E (colagem real pela área de transferência do Windows, árvore atualizada, cancelar e confirmar exclusão, caminhos recusados) |
| 14.6 ✅ | Divisores da barra lateral | Entre Workspaces, Projetos, Conversas e Pastas há divisores que se arrastam (ou se movem com as setas ↑/↓, Shift para passo maior); a altura escolhida fica salva e o duplo clique devolve as seções vizinhas ao tamanho automático. Cada seção tem mínimo de 56 px (Pastas, 72 px) e a lista dentro dela rola | Unidade (regras dos divisores e mínimos) + E2E (arrastar, teclado, mínimo, persistência, duplo clique) |
| 14.7 ✅ | Abrir conversa sem travar o app | Correção: a medição de contexto lia o fim da transcrição do Claude Code (até 32 MB) de forma síncrona no processo principal a cada abertura; num disco lento (ex.: antivírus examinando um arquivo de 136 MB acabado de mudar) uma única leitura levou 114 s e congelava a janela. Agora a leitura é assíncrona, guardada por data de modificação do arquivo, compartilhada entre aberturas simultâneas e tem prazo de 4 s (passado o prazo vale a última medição guardada e a leitura termina em segundo plano) | Unidade (leitura compartilhada, nova leitura quando o arquivo muda, falha não guardada, prazo com disco lento) |
| 14.8 ✅ | Abertura animada | Ao abrir o app, uma janelinha quadrada sem moldura aparece no centro da tela e o logo se forma: o fundo surge, o planeta aparece girando, a órbita se desenha enquanto a lua dá a volta e o nome entra, na cor de destaque escolhida. A janela principal só aparece quando está pronta e a animação já teve ao menos 2 s; a abertura some com um esmaecimento. É só HTML e CSS (sem JavaScript, sem preload, CSP bloqueando tudo além dos estilos); com "reduzir movimento" do Windows mostra direto o logo pronto. O exemplo das Instruções gerais deixou de citar a organização | Unidade (HTML sem script, CSP, cor e nome escapados) + E2E (abertura primeiro, depois só a janela principal visível) |
| 14.9 ✅ | Crédito do desenvolvedor | Em Configurações › Sobre: "Desenvolvido por: Felipe Ferreira", com links para o portfólio (felipeferreira.dev) e o GitHub. Os links abrem no navegador padrão (só https) | E2E (texto e endereços dos links, abrir em nova janela com noopener) |
| 15.1 ✅ | Versão base para compartilhar | O repositório deixou de citar a organização e o computador do autor (documentos, nomes de exemplo nos testes, caminhos dos scripts de investigação) e ganhou um README com o passo a passo de instalar, conectar o Claude e desenvolver. O instalador já sai com a marca padrão "Nexus" e sem dados pessoais; o app usa o Claude Code instalado em cada máquina, então cada pessoa entra com a própria conta. Pendências conhecidas: o instalador não é assinado (aviso do SmartScreen em arquivos baixados) e o histórico do Git tem o e-mail do trabalho nos commits | Unidade (427 passam, sem mudança de comportamento) |
| 15.4 ✅ | Botão direito na árvore de arquivos | Menu com copiar, colar (na pasta clicada), renomear (F2), ver no Explorer e excluir (Lixeira); colar de itens copiados na própria árvore não passa pela trava das pastas do app | Unidade e E2E |
| 15.5 ✅ | Perguntas do Claude (AskUserQuestion) | A ferramenta de perguntas deixou de aparecer como "permitir/negar": vira um cartão com as opções (escolha única, múltipla e "Outra"), e as respostas voltam ao Claude em `answers`; "Dispensar" orienta o Claude a seguir com uma suposição | Unidade e E2E com o Claude real |
| 15.6 ✅ | Renomear conversa | Duplo clique, F2 ou lápis na lista; o nome também é gravado na sessão do Claude Code (`renameSession`), então aparece igual no VS Code. Medido: trocar o esforço não regrava o cache da conversa (só trocar de modelo regrava) | Unidade e E2E com o Claude real |
| 15.7 ✅ | Avisos de atualização | Faixa no topo: versão nova do Claude Code (consulta `registry.npmjs.org` no máximo a cada 6 horas, falha em silêncio; botão Atualizar abre `claude update` num console e, ao voltar, relê versão e modelos) e modelo novo na conta (compara com a lista já vista, guardada em `seenModels`; no primeiro uso nada é novidade). Os modelos vêm do Claude Code instalado, então um modelo novo só aparece depois de atualizá-lo | Unidade e E2E com o Claude real |
| 15.8 ✅ | Segurança e robustez (análise do Fable 5.2) | Regra "sempre permitir" não vira regra ampla (`node -e`, `git -C`); fila de mensagens devolve a mensagem se o envio falha; backup do banco (`VACUUM INTO`, a cada 12 h, 5 cópias em `userData/backups`). |
| 15.9 ✅ | Galáxia parada | Só desenha quando algo muda (câmera, hover, animação) e para com a aba escondida; menos CPU/GPU em repouso. |
| 15.10 ✅ | Limpeza de processos e testes | Na abertura, encerra processos do Claude Code órfãos de um Nexus finalizado à força (`orphan-reaper.ts`, reconhece pela marca `--system-prompt-snapshot` e pai inexistente); testes de junction pulam sozinhos sem permissão; o watcher das notas ignora `node_modules`, `dist`, `out`, `build`. |
| 15.11 ✅ | Rascunho e fila sobrevivem a recarregar | O texto ainda não enviado fica guardado por conversa (`localStorage`, também ao trocar de conversa); a fila de mensagens é recomposta pelo canal `chat:queues` (a fila vive no processo principal). |
| 15.12 ✅ | Índice de notas e conversas longas | Se o índice das notas não cabe no prompt, ficam as mais ligadas (mapas) e não só as mexidas por último; a conversa mostra as últimas 100 mensagens com botão "Mostrar mensagens anteriores". Documentação corrigida (SessionManager, tabelas, sem Shiki). |
| 15.13 ✅ | Planetas em órbitas | Dentro de cada sistema os planetas giram em órbitas concêntricas em volta da estrela (mais conectados por dentro), com folga calculada pelo tamanho e anel: nenhum encosta em outro. As órbitas aparecem como traço fino na cor do sistema. |
| G1 ✅ | Galáxia Viva: modo ambiente e modos Leve/Original | Perfis de qualidade (`galaxy/quality.ts`): Leve (padrão, dia a dia) e Original (referência). Relógio do movimento ambiente (`galaxy/ambient.ts`): giro e futuras animações no ritmo do perfil (Leve 30 fps e parado sem foco; Original 60/30), nunca com movimento reduzido; sem nada animando, continua o desenho sob demanda. A troca vale na hora (`setProfile`), sem mexer em câmera, seleção, posições ou personalizações. Preferência `galaxyQuality`, canais `galaxy:getQuality`/`galaxy:setQuality`, escolha em Configurações → Aparência. Plano completo: nota "Nexus - Galáxia Viva". |
| 14.10 ✅ | Vídeo de abertura | A abertura passou a tocar o vídeo da marca (`build/intro/intro.webm`, 720×720, 4 s) numa janela quadrada de cantos arredondados, sem JavaScript e com os controles do player escondidos. O app só aparece depois do vídeo inteiro. O vídeo vai fora do ASAR (`resources/intro` no instalador). Só vale para a marca padrão "Nexus" (o vídeo traz o nome desenhado); outras marcas e a falta dos arquivos usam a animação em SVG de antes | Unidade (arquivos, página sem script, controles escondidos, instalador leva a pasta) + E2E (vídeo carregado, janela 420×420, app só depois de 4 s) |
| 14.11 ✅ | Respostas em segundo plano | Correção: quando o Claude "avisa quando terminar" uma tarefa em segundo plano, o Claude Code o acorda sozinho e ele escreve o resultado sem mensagem do usuário; o Nexus descartava essa resposta (só aceitava mensagens durante um turno iniciado por uma mensagem). Agora a resposta espontânea vira uma mensagem gravada da conversa, aparece em andamento na tela e a conversa conta como "respondendo" enquanto ela escreve. Conversas que não estão abertas ganham uma bolinha de "Resposta nova" na barra lateral. O processo não é mais fechado por ociosidade (10 min) enquanto houver tarefa em segundo plano rodando (até 2 h), porque fechá-lo matava a tarefa. Resposta espontânea vazia é descartada | Unidade (sessão, serviço de chat, tela) + E2E real com Haiku (comando de 25 s em segundo plano; o resultado aparece sozinho) |
| 14.12 ✅ | Horário das mensagens | Cada mensagem, do usuário e do Claude, mostra o horário em que foi gravada, sempre visível e discreto ("14:32" no próprio dia, "ontem 14:32", "07/11 14:32" e com o ano quando for de outro). A dica ao passar o mouse traz a data completa com segundos. Usa o fuso do computador. O horário da resposta do Claude é o do fim dela | Unidade (formatação, virada do dia, data inválida) + E2E (horário em todas as mensagens, formato e dica) |
| 13+ | Pós-MVP | FTS5 + MCP de conhecimento, busca nas conversas, exportação, anexos/PDF. Se fizer falta no uso: git básico (alterações na árvore, diff, commit, push), busca nos arquivos do projeto e terminal integrado | — |

Os testes que usam o CLI de verdade gastam a cota do plano. Por isso só rodam com `NEXUS_LIVE_TESTS=1`.

## 13. Premissas validadas na Etapa 0 ✅

Todas as dez foram confirmadas em 2026-10-30. Detalhes e números em [`spikes/claude-sdk/RESULTADOS.md`](../spikes/claude-sdk/RESULTADOS.md). Regras obrigatórias que saíram do spike:

1. **Ferramentas:** restringir com `disallowedTools`. Nunca passar `tools` sem `ToolSearch`: os MCPs entram todos de uma vez e o contexto vai de ~25 mil para ~100 mil tokens.
2. **Ambiente:** remover `CLAUDE_CODE_*`, `CLAUDECODE` e `ANTHROPIC_API_KEY` do processo filho.
3. **Sessões:** usar sempre o modo de entrada contínua (`prompt` como `AsyncIterable`), com `uuid` próprio em cada mensagem (necessário para `rewindFiles`). O `error_during_execution` depois de `interrupt()` significa "interrompido". O fim de um turno (`result`) só vale se trouxer o `user_message_uuid` da mensagem enviada: o Claude Code também inicia turnos sozinho (por exemplo, o aviso de uma tarefa em segundo plano ao retomar uma conversa do VS Code), e cada um termina com um `result` próprio, sem uuid. Esses são ignorados, e o que produziram é descartado.
4. **Snapshot:** usar `extraArgs: { 'system-prompt-snapshot': 'off' }`, para que instruções alteradas valham na próxima mensagem.
5. **Desfazer:** `enableFileCheckpointing: true` + `rewindFiles(uuid)`, sem mecanismo próprio.
6. **Importar conversas:** `listSessions({ dir })`.
7. **Modo Auto:** o classificador decide e só pergunta via `canUseTool` quando não consegue decidir.

Pendências: testar um compartilhamento real do `servidor` e a máquina pessoal.
