# NEXUS — ESTUDO DE REFERÊNCIA VISUAL E FUNCIONAL
## Projeto: Galaxy Eclipse / Second Brain Black Hole — briefing para o Claude Code

> **IMPORTANTE:** este documento descreve um vídeo de referência analisado externamente, pois você não consegue assistir ao MP4 diretamente. Acompanha oito imagens extraídas do vídeo nos tempos indicados. Não presuma que mecanismos não mostrados realmente existem.

### 1. Contexto do Nexus (preservar)

O Nexus é meu aplicativo pessoal para Windows, construído com Electron, React, TypeScript e SQLite. Ele possui:
- segundo cérebro em Markdown com `[[wiki links]]`, tags, editor de notas e Galáxia 3D;
- conversas com Claude Code por workspace/projeto, permissões sob aprovação, diffs, undo e contexto;
- explorador de código.

A Galáxia atual usa **Three.js puro, não React Three Fiber**. Pelo diagnóstico anterior (`galaxy-scene.ts`, `planet-material.ts`, `layout.ts`, `GalaxyView.tsx`): há planetas instanciados com seis biomas, Fresnel, brilho de atualização, nebulosas, órbitas e conexões. O layout é estável, a renderização é sob demanda e já foi testada com cerca de 1.200 notas. **NÃO reescreva a arquitetura nem elimine recursos já existentes.**

Já estamos trabalhando no plano Galáxia Viva G1–G9. Este novo vídeo é uma **referência adicional**, não autorização para substituir o planejamento. Há duas configurações de desempenho definidas: **MODO LEVE** (uso diário; custo gráfico reduzido) e **MODO ORIGINAL** (manter a experiência atual como baseline e permitir a qualidade plena/efeitos previstos). Preservar a escolha e não perder personalizações.

### 2. Referência identificada

**Second Brain Black Hole**, de William Wasenmiller, com repositório MIT: https://github.com/williamwasen/second-brain-black-hole

Demonstração pública: https://williamwasen.github.io/second-brain-black-hole/
Página do plugin Obsidian: https://community.obsidian.md/plugins/second-brain-black-hole

A documentação pública descreve: um buraco negro central, estrelas representando notas, grupos por pastas/tags/links, links entre notas, distorção gravitacional visual, navegação 3D, clicar para abrir notas, importação de Markdown, WebGL2 e execução local. A demo pública também possui painel Home, Pages, busca e gráficos. O plugin/visualizador NÃO é um app completo de edição nem possui Claude ou sincronização incorporados. Não atribua ao plugin funções do Nexus.

Os efeitos no código de origem são descritos como **fisicamente inspirados**, NÃO uma simulação relativística exata. Investigue a implementação real antes de considerar reaproveitamento; respeite licença, atribuição e compatibilidade de dependências.

### 3. Descrição quadro a quadro do vídeo (aprox. 28,3s, 880×576 / 30 fps)

**Imagem 01 — 3,0 segundos — `01_visao_geral_e_saudacao_3.0s.png`**
- Página escura quase totalmente preta, com cabeçalho minimalista.
- No canto superior esquerdo surge uma saudação personalizada e uma espécie de briefing escrito; no alto central botão `Home`, no alto direito `Pages`.
- No centro, um buraco negro dourado. Ao redor, uma esfera/nuvem de centenas de pontos brancos, conectados por linhas finíssimas.
- Rótulos legíveis para agrupamentos, como `Reviews`, `Plans`, `Reference notes`, `Decisions`, `Projects` e `Trackside knowledge`, alguns com contagem de ideias.
- No rodapé existe uma pequena barra flutuante de navegação.
- Não assumir que o briefing foi criado automaticamente ou por IA: a imagem não demonstra esse mecanismo.

**Imagem 02 — 6,8 segundos — `02_buraco_negro_em_perspectiva_6.8s.png`**
- A câmera muda de perspectiva e o disco de acreção se torna oblíquo/quase horizontal, criando profundidade convincente.
- O núcleo preto tem um anel intensamente brilhante dourado/branco; a luz parece contorná-lo de forma assimétrica.
- Milhares de pontos de poeira próximos ao disco formam um efeito de turbulência; a periferia tem fumaça cinza bem fraca.
- A magia visual é a combinação de lente gravitacional simulada, disco de acreção, brilho local e câmera orbitando; não afirmar que há física real.

**Imagem 03 — 10,8 segundos — `03_rede_e_arcos_orbitais_10.8s.png`**
- Grande campo de nós e pequenas constelações; linhas entre nós pouco opacas, com brilho pontual nos vértices.
- Arcos largos e finíssimos contornam a periferia da composição, alguns com pontos brilhantes em movimento.
- A hierarquia visual é clara: buraco negro > grupos rotulados > nós > linhas > poeira de fundo.

**Imagem 04 — 12,0 segundos — `04_foco_em_sistema_12.0s.png`**
- Aparece um controle de retorno no canto esquerdo (ex.: `Trackside knowledge`), sugerindo navegação contextual entre regiões/agrupamentos.
- Agrupamentos e conexões ficam distribuídos espacialmente ao redor do foco.
- O movimento de câmera é fluido e não se percebe um rearranjo abrupto de posições.

**Imagem 05 — 15,7 segundos — `05_efeito_de_lente_gravitacional_15.7s.png`**
- Visão lateral do núcleo com um disco luminoso e a impressão de que a luz atrás do buraco é desviada.
- Menos rótulos; a câmera dá destaque ao fenômeno visual e à poeira do entorno.
- É a imagem visualmente mais marcante: contraste extremo, luz âmbar/dourada, preto profundo e gradações sutis.

**Imagem 06 — 16,4 segundos — `06_painel_lateral_da_nota_16.4s.png`**
- Ao focar um nó, várias conexões tornam-se mais visíveis, irradiando de uma nota selecionada.
- Abre um painel lateral direito `Pages` com busca `Search pages`, seletor de registro, tipo do item (`CHAT RECORD`), título, data de atualização, botão `Open file` e texto/resumo do conteúdo.
- O universo continua visível à esquerda. O painel tem fundo escuro translúcido, bordas suavemente arredondadas e hierarquia tipográfica compacta.
- A imagem confirma leitura/navegação em um registro, mas não prova editor de texto integrado.

**Imagem 07 — 21,2 segundos — `07_home_dashboard_indicadores_21.2s.png`**
- Painel `Home` central, flutuando POR CIMA da Galáxia, sem descaracterizar o fundo.
- Quatro indicadores: `Pages`, `Ideas`, `Links` e `Updated this week`, com cores distintas e minigráficos.
- Cards seguintes: `Pages updated` (histograma temporal), `Ideas by group` (barras por grupo), `Most connected pages` (ranking por número de links).
- Parte inferior: `Recent activity` e `Newest conversation summaries`.
- Números vistos no vídeo (exemplo daquele usuário, NÃO requisitos para o Nexus): cerca de 112 páginas, 795 ideias, 391 links, 15 atualizadas na semana.

**Imagem 08 — 22,5 segundos — `08_busca_e_atividade_recente_22.5s.png`**
- Barra de busca grande no topo do painel `Home`, com o texto `Search every page and conversation...`.
- Indicadores e listas convivem sem interromper o ambiente 3D de fundo.
- A interface usa uma só superfície de dashboard, sem dezenas de janelas separadas.
- A busca global no Nexus só deve incluir fontes já existentes e autorizadas; não deve criar consultas ao Claude por si.

### 4. Por que esse visual funciona tão bem

1. **Foco cinematográfico central:** o buraco negro funciona como âncora visual reconhecível.
2. **Hierarquia em camadas:** núcleo, regiões, pequenos nós, conexões e partículas de fundo têm intensidades separadas.
3. **Luz crível:** brilho dourado no centro e resto quase preto; nada parece neon uniforme.
4. **Profundidade por câmera, oclusão e escala:** o disco do buraco negro muda de aparência durante a órbita da câmera.
5. **Minimalismo de UI:** controles discretos, painéis somente sob demanda.
6. **Integração funcional:** dashboard, busca e leitura se sobrepõem à experiência 3D sem forçar navegação para outra tela.

### 5. Recomendação para adaptar ao Nexus (não copiar literalmente)

**A. Um preset visual opcional `Eclipse`**, inspirado na iluminação e composição do vídeo, separado da configuração de desempenho. `Estilo visual` poderia ser `Nexus atual` ou `Eclipse`. Em cada estilo, permitir `Leve`/`Original` (ou os níveis já definidos). O estilo atual nunca deve ser apagado. O nome `Eclipse` é apenas uma sugestão para prototipação.

**B. Elemento central opcional:** no preset Eclipse, estudar um núcleo gravitacional/buraco negro decorativo ou funcional para a visão geral do Workspace. NÃO transformar automaticamente todas as notas em estrelas, nem substituir sistemas solares existentes. Explorar se o centro poderia representar `Workspace` ou `Visão geral`, sem interferir nas coordenadas e na seleção das notas. Se isso comprometer a legibilidade, prefira um fundo cosmológico sutil sem núcleo dominante.

**C. Shader e iluminação:** avaliar disco de acreção estilizado (disco com emissão, distorção de amostra/tela ou shader aproximado, contorno luminoso, partículas orbitais), SEM ray tracing caro e sem assumir simulação relativística. Renderização em lote, desacoplar de React, descartar recursos corretamente, controlar bloom/tonemapping.

**D. Campo de estrelas e conexões:** em zoom distante, permitir LOD (level of detail) de planetas -> pontos luminosos compactos, mantendo os tipos e a geometria atual em zoom próximo. Mostrar ligações com opacidade adaptativa, sem tentar desenhar todas as etiquetas ao mesmo tempo. Preservar IDs, links, pins, layout e aparências personalizadas.

**E. Rotas e arcos luminosos:** estudar apenas como camada decorativa de baixa frequência; não competir com conexões semânticas entre notas. Diferenciar linhas de relacionamento (reais) de arcos ornamentais.

**F. Painel lateral `Pages`:** estudar evolução do painel de detalhes atual do Nexus, usando pesquisa, prévia e links ao redor da nota selecionada, sem duplicar editor nem descaracterizar o painel existente. Busca e seleção devem ser funcionais, não apenas design.

**G. Dashboard `Home` sobre a Galáxia:** ideia de alto valor. Prototipar painel opcional com contagem de notas, conexões, notas modificadas na semana, quantidade por sistema, top notas com mais links, histórico de edição, atividade recente. Resumos de conversas SOMENTE se já existirem como dados no Nexus; não gerar novas chamadas ao Claude por causa de um painel visual. Métricas devem ser calculadas a partir dos dados existentes, sem expor conteúdos confidenciais fora do computador.

**H. Busca universal:** aproveitar busca já disponível, se houver. Pesquisa deve realçar nós e permitir navegar até os resultados; se futuramente integrar chats, usar apenas índices locais autorizados. Preservar orientação da câmera e posição dos planetas.

**I. Microinterações:** aproximar câmera ao grupo clicado com interpolação suave, autoenquadrar nó selecionado, destacar suas ligações, permitir retorno ao enquadramento anterior; `Home` e `Pages` aparecem como overlay sem reiniciar a cena WebGL.

### 6. O que NÃO quero copiar

- Não transformar o Nexus inteiro em uma galáxia monocromática de pontos, perdendo os planetas 3D atuais.
- Não usar um buraco negro gigante como único centro obrigatório de toda navegação.
- Não tornar a informação ilegível por brilho excessivo, linhas de mais ou partículas demais.
- Não tentar reconstruir todo o front-end nem substituir Three.js puro ou a arquitetura atual pelo repositório de referência.
- Não criar IA para gerar saudações, resumos, conexões ou insights sem autorização explícita: nada pode adicionar tokens.
- Não atrelar o uso diário a shaders pesados ou 60 FPS contínuos.
- Não usar os números e textos do vídeo como dados reais do Nexus.
- Não instalar dependências nem copiar código antes de avaliar licença, segurança e manutenção.

### 7. Modo LEVE e modo ORIGINAL — manter rigorosamente

**LEVE (padrão para o meu uso diário):** limitar FPS, efeitos ambientais e tamanho de renderização; preservar leitura e navegação; usar shader simplificado do disco de acreção quando necessário; reduzir quantidade de partículas, blur volumétrico e pós-processamento; desligar quando Galáxia oculta; suspender em janela minimizada; renderizar sob demanda quando tudo estiver parado.

**ORIGINAL:** preservar como referência a experiência atual, sem destruição de opções manuais, órbitas, materiais e recursos; permitir comparar com a nova proposta e usar qualidade gráfica completa quando escolhida.

**Separação sugerida:** `Estilo da Galáxia (Atual / Eclipse)` não é a mesma coisa que `Qualidade (Leve / Original)`. Trocar estilo ou qualidade não deve reconstruir o grafo, alterar posições nem perder personalização.

### 8. Integração com o plano G1–G9

Avalie compatibilidade com:
- G1: relógio/mode ambiente/qualidade.
- G2: atmosfera, nebulosa, estrelas e câmera.
- G3: fluxo em links e cometas.
- G4: naves ambientais.
- G5: eventos do Claude nos arquivos/notas que realmente existem no grafo; não inventar planeta para arquivo de código.
- G6: biomas/metadados, respeitando overrides manuais.
- G7: luas e anexos.
- G8: destaque da busca.
- G9: câmera/tour e dashboards opcionais.

Se o visual Eclipse exigir etapa própria, proponha uma **GE — estudo/protótipo de estilo**, sem jogar fora o roadmap existente.

### 9. Segurança e desempenho

- Sem chamadas adicionais ao Claude, tokens, APIs externas ou telemetria.
- O renderizador deve continuar isolado e respeitar o contrato validado do Electron.
- Ler apenas dados já indexados pelo SQLite/estado React ou por contratos internos aprovados.
- Usar geometria compartilhada, instancing, LOD, shaders, limites de draw calls e dispose correto de recursos.
- Cuidar de GPU integrada/modesta, além de testes na máquina de uso diário.
- Medir FPS, tempo de abertura, RAM, GPU/CPU observáveis e tempos de troca entre abas em bases pequenas e grandes.
- Garantir que overlays não prendam foco, ocultem informações essenciais nem bloqueiem cliques indevidamente.
- Navegação por teclado e `prefers-reduced-motion` quando aplicável.
- Definir critérios de aceitação e rollback por etapa.

### 10. O que preciso de você agora

**NÃO IMPLEMENTE NADA AINDA.** Quero primeiro um relatório objetivo, ancorado no código REAL do Nexus e no repositório de referência:

1. Compare o vídeo e a demo com o Nexus atual, identificando o que já existe, o que pode ser apenas refinado e o que seria novo.
2. Examine os arquivos do `second-brain-black-hole` em leitura para entender a técnica do buraco negro e a estrutura de dados. Não copie o projeto inteiro.
3. Descreva opções de implementação de um visual `Eclipse` (preferência por shader procedural/efeito aproximado de baixo custo), com prós, contras, riscos e estimativa de esforço.
4. Proponha o layout e as interações do dashboard Home e do painel lateral, integrando à UI existente.
5. Mostre como preservar `Nexus atual`, `LEVE` e `ORIGINAL` sem confundir tema com desempenho.
6. Identifique métricas que podem ser extraídas do banco/indexador atual sem chamadas extras ou leituras caras.
7. Proponha fases pequenas e testáveis, integradas ao G1–G9, com protótipo visual isolado e botão de desfazer/rollback.
8. Liste tudo que é apenas hipótese sua e depende de validação.
9. Deixe claro o que NÃO deve ser implementado por custo, duplicação ou falta de utilidade.

Primeiro quero a análise e um plano. Aguarde minha aprovação antes de alterar arquivos, instalar bibliotecas, executar código de terceiros ou criar o protótipo.
