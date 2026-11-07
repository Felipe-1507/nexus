# 0006: Segundo cérebro compatível com o Obsidian e visualização em galáxia

**Status:** aceita (2026-10-30)

## Decisão
- O vault usa Markdown puro, frontmatter YAML, `[[wikilinks]]`, `#tags` e uma pasta de anexos. A mesma pasta abre no Obsidian, sem nada preso ao Nexus.
- **O Claude é o curador:**
  - o prompt traz as convenções do vault;
  - ele cria, atualiza e liga notas sozinho;
  - ele atualiza uma nota existente em vez de criar outra duplicada.
- **Economia de tokens:** o prompt recebe só um índice curto das notas, e o Claude abre apenas a nota necessária. Busca FTS5 e MCP interno vêm no pós-MVP.
- O editor de notas é o CodeMirror 6, o mesmo do Obsidian.
- A **galáxia** é feita com Three.js:

  | No vault | Na galáxia |
  |---|---|
  | Workspace | Galáxia |
  | Pasta ou projeto | Sistema solar |
  | Nota | Planeta (tamanho conforme o número de conexões) |
  | `[[link]]` | Rota de luz |
  | Nota recente | Brilho |

  Ela abre sob demanda e entra como a primeira etapa depois do MVP.

## Implementação (Etapa 8)
- **Vault** (`core/knowledge/vault.ts`): a pasta `Conhecimentos/` do Workspace.
  - Caminhos relativos com `/`, verificados de forma léxica e pelo `realpath`. Junctions e links que apontem para fora são recusados, e há teste com junction real.
  - Ocultos (`.obsidian`, `.git`, `.trash`) não aparecem.
  - Nomes de arquivo válidos no Windows (acentos e espaços mantidos).
  - Excluir move para `.trash/`. A gravação recusa sobrescrever uma alteração feita por fora (mtime).
- **Índice** (`note-index.ts`):
  - título (frontmatter `title`, primeiro `#` ou nome do arquivo);
  - resumo (frontmatter `summary`/`description` ou primeiro parágrafo);
  - `#tags` e `[[links]]`, ignorando blocos de código.
  - Links resolvidos como no Obsidian: caminho parcial, nome sem diferenciar maiúsculas ou `aliases`, preferindo a mesma pasta. Backlinks por inversão.
- **Watcher** (chokidar): invalida o índice e avisa a tela (`knowledge:event`) quando qualquer programa altera o vault.
- **Prompt:**
  - seção "Segundo cérebro" com a pasta e o índice, das notas mais recentes para as mais antigas, limitado a ~6.000 caracteres e indicando quantas ficaram de fora;
  - regras de curadoria (só fora do modo somente leitura): atualizar em vez de duplicar, ligar com `[[...]]` e terminar com "Registrei em [[Nota]]".
- **O índice não reabre a sessão:** ele fica fora da `promptKey`. Nota nova vale a partir da próxima sessão, e o Claude sempre pode procurar na pasta.
- **Interface:** a aba Nota do painel direito traz a árvore com filtro e o editor CodeMirror 6 com prévia. `[[links]]` são clicáveis, e um link para nota inexistente cria a nota. Há "Mencionada em" e conflito com alterações de fora. Cartões de notas alteradas pelo Claude abrem a nota ao lado da conversa.

## Implementação (Etapa 11)
- **Duas formas de ver:**
  - **Tela cheia** (barra lateral → "Galáxia"): clicar num planeta abre a nota no painel direito, ao lado da galáxia.
  - **Aba do painel direito**, ao lado do chat (a busca e o cartão se ajustam à largura): o clique só seleciona e leva a câmera até o planeta, para explorar sem trocar de aba a cada clique, e "Abrir nota" abre.
  - Com a tela cheia aberta, a aba só avisa, para não haver duas galáxias desenhando ao mesmo tempo.
- **Grafo** (`NoteIndex.graph()`, canal `knowledge:graph`):
  - notas com título, sistema (pasta de primeiro nível; `''` = núcleo), tags, mtime e grau;
  - links resolvidos como no Obsidian, uma rota por par de notas (ida e volta contam uma vez), sem links para si mesma nem para notas que não existem.
- **Disposição sem simulação física** (`features/galaxy/layout.ts`):
  - cada sistema segue uma espiral (ângulo de ouro) e fica na menor distância do centro em que não encosta em nenhum anterior;
  - dentro do sistema, as notas mais conectadas ficam perto da estrela, e o ângulo vem de um hash do caminho;
  - as posições não mudam entre aberturas. Mil notas são dispostas em poucos milissegundos.
- **Desenho** (Three.js, `features/galaxy/galaxy-scene.ts`):
  - planetas e estrelas como instâncias, e as rotas num único conjunto de linhas, uma chamada de desenho para cada;
  - halos e "poeira" em volta dos sistemas com um shader de pontos;
  - nomes dos sistemas e da nota sob o mouse em HTML sobre o canvas.
  - Notas mexidas nos últimos 7 dias brilham, e o brilho apaga até os 30 dias.
- **Navegação:**
  - órbita, zoom e arrasto (OrbitControls);
  - rotação lenta até o primeiro toque, desligada com "reduzir animações" do Windows;
  - a busca ignora acentos e leva a câmera até o planeta. As rotas da nota selecionada ficam destacadas.
- **Ao vivo:** o watcher do vault atualiza a galáxia sem mexer na câmera, e a seleção é mantida pelo caminho.
- **Desempenho**, medido com 1.200 notas e ~3.500 rotas:
  - **Índice assíncrono e incremental:** as notas são lidas em paralelo, sem travar o processo main, e depois de uma alteração só as notas com mtime diferente são relidas. Era síncrono e travava o app enquanto lia.
  - **Varredura do índice:** usa as entradas da pasta (que já não seguem links nem junctions), sem `realpath` por arquivo, que custava ~2 ms por nota. O `realpath` continua em tudo que vem da interface.
  - **Antivírus:** na primeira leitura de arquivos recém-criados, o antivírus do Windows examina cada um (~7 ms por arquivo no Electron). Para 1.200 arquivos novos são alguns segundos, uma única vez.
  - **Abertura imediata:** com o app ocioso, o código da galáxia e o grafo são adiantados, e a tela é montada sem `Suspense` (com `lazy`, o React segurava a tela por mais de um segundo mesmo com tudo pronto).
  - **Resultado:** a galáxia de um vault existente fica pronta em ~0,3–0,6 s depois do clique e roda a 60 quadros por segundo.

## Planetas com vida (Etapa 12.4)
- **Aparência sorteada e estável:** o caminho da nota decide o planeta (`src/shared/planets.ts`), então ele é sempre o mesmo. Há seis tipos (rochoso, gasoso, oceano, gelo, lava e deserto), com atmosfera e anéis em parte deles.
- **Textura no shader:** cada planeta é uma instância de uma esfera só. Manchas, faixas, nuvens e veios saem de ruído calculado na placa de vídeo a partir de atributos por instância (cores, tipo, semente), sem imagens. Os anéis são outro conjunto de instâncias. A galáxia de 1.200 notas continua a 60 quadros por segundo.
- **Tamanho:** cresce com as conexões e, mais devagar, com o conteúdo da nota (`0,55 + 0,2·√conexões + 0,28·log10(1 + caracteres/300)`, com limite).
- **Edição:** o cartão do planeta troca tipo, cor, anéis, atmosfera, sorteio e uma anotação. Só o que foi trocado é guardado, em `Conhecimentos/.planetas.json`: arquivo oculto (o vault e o watcher ignoram), que viaja junto com as notas e não aparece no Obsidian. Mover ou renomear uma nota devolve o planeta ao sorteio.

## Consequências
- Os wikilinks e backlinks entram no MVP (Etapa 8), porque são a base da galáxia.
- O índice de notas precisa ser enxuto. Um vault grande jogado inteiro no contexto anularia a economia.
