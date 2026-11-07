# 0010: Gerenciador de contexto das conversas

**Status:** aceita (2026-11-04)

## Contexto
Uma conversa longa do Claude Code é reenviada inteira a cada passo (quase toda vinda do cache). A análise dos dados reais de uso mostrou três coisas:
- uma conversa de ~440 mil tokens custa mais de 10 vezes mais por passo que uma conversa nova (~30 mil);
- depois de mais de 1 hora parada, o cache expira e a primeira chamada regrava o contexto inteiro (≈70% do custo do turno que mais pesou);
- o `usage` que o Nexus guardava era a **soma** das chamadas do turno, não o tamanho do contexto, e nada na tela mostrava isso.

## Decisão
- **A medição vem de dados que já chegam.** Ao fim de cada turno o Nexus guarda o uso da **última chamada à API** (entrada nova, cache lido, cache gravado), a janela do modelo (`result.modelUsage[modelo].contextWindow`) e o custo de lista do turno. A soma das categorias do `getContextUsage()` do SDK conferiu exatamente com esse número, então a última chamada é o contexto real.
- **Nunca se abre uma sessão nem se chama a API só para medir.** `getContextUsage()` exige um processo aberto, e abrir um processo já escreve no arquivo da sessão. Ele não é usado.
- **Conversas antigas** (importadas do VS Code, ou usadas fora do Nexus depois da última medição) são lidas do **fim** do arquivo de transcrição do Claude Code (`transcript-tail.ts`: 143 MB em ~13 ms). O resultado é marcado como "reconstruído". Se não houver arquivo, uso ou janela, a tela mostra "indisponível". Nenhum número é estimado.
- **Janela desconhecida = sem percentual.** Uma conversa sem janela própria só herda a de outra conversa do **mesmo modelo** (dado real de outra origem), e a tela diz isso.
- **Cache:** o Claude Code usa a camada de 1 hora (`ephemeral_1h`). Depois de 1 hora parada a tela diz que o cache **pode** ter expirado. A confirmação vem depois: se a primeira chamada do turno gravou metade ou mais do contexto, o turno é marcado como "cache regravado".
- **Mudança do prompt:** o hash do prompt do sistema de cada turno fica guardado. Se ele mudou desde a última mensagem (por exemplo, o índice de notas), reabrir a sessão não aproveita o cache, e a tela avisa (só para conversas grandes, sem processo aberto).
- **Continuar em nova conversa** (nunca automático): `forkSession()` do SDK (cópia local do arquivo, sem processo nem API), `/compact` nativo **só na cópia**, e uma conversa nova apontando para ela. Com o resumo estruturado ligado (padrão), as instruções das seis seções vão no próprio `/compact`, então o resumo sai da mesma chamada, sem mensagem extra, e é mostrado na conversa nova.
  - A sessão original não é aberta nem alterada (comprovado por hash do arquivo nos testes).
  - Qualquer falha cancela tudo: a cópia (e só a cópia) é apagada, nenhuma conversa é criada e o pedido pode ser repetido. Repetir depois do sucesso devolve a mesma continuação; dois pedidos ao mesmo tempo são recusados.
  - O histórico de "Desfazer" de arquivos não é copiado pelo fork, e a confirmação avisa isso.
  - A compactação registra `pre_tokens`, `post_tokens`, duração e custo de lista (tabela `compactions`).
- O custo em dólar é **preço de lista, uma referência**. Ele não representa a porcentagem da cota do plano, e a tela sempre diz isso.

## Alternativas descartadas
- **Resumo próprio do Nexus a partir das mensagens guardadas:** perde o que só existe nas saídas de ferramentas.
- **Esconder mensagens na tela:** continuaria enviando o histórico inteiro.
- **Compactar a própria conversa original:** alteraria a sessão; o fork preserva a original.
- **Ligar o RTK ao Nexus:** ele já funciona (o hook vem das configurações do usuário) e economiza só a saída de comandos, não o contexto.

## Consequências
- Tabelas novas `conversation_context` e `compactions`, e a coluna `conversations.forked_from` (migração 0009).
- Canais `context:get`, `context:overview`, `context:continuePreview`, `context:continue`, `context:thresholds` e `context:setThresholds`.
- Limites de faixa configuráveis (padrão 50/75/90%) em Configurações.
- O primeiro turno de cada modelo informa a janela dele; até lá, conversas daquele modelo mostram tokens sem percentual.
