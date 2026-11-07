# NEXUS
## Documento de visão e especificação do projeto

**Versão do documento:** 1.0 — Planejamento inicial

---

# 1. Visão geral

O **Nexus** será um aplicativo desktop para Windows que combina duas ideias principais:

1. Um ambiente de interação com inteligência artificial, utilizando o Claude Code como motor de execução e raciocínio.
2. Um segundo cérebro digital, capaz de organizar conhecimentos, documentos, projetos, anotações e informações de maneira persistente.

A proposta é criar um ambiente centralizado no qual o usuário possa conversar com uma IA, desenvolver projetos, consultar informações, registrar conhecimentos e organizar sua vida profissional e pessoal.

A inspiração vem da combinação de ferramentas como Cursor, VS Code, Obsidian e interfaces modernas de chat com inteligência artificial.

Entretanto, o Nexus não deve ser apenas mais um editor de código com um chat lateral.

**O chat será o elemento principal da experiência.** Arquivos, projetos, documentos e conhecimentos estarão integrados ao redor dele.

O objetivo é transformar o aplicativo em um ambiente de trabalho inteligente, no qual a IA tenha acesso ao contexto relevante de cada Workspace e possa trabalhar diretamente nos arquivos e projetos do usuário.

# 2. Identidade e posicionamento

Nexus representa conexão, vínculo e convergência: a ideia de um núcleo inteligente que conecta informações, conhecimentos, projetos e ferramentas.

O nome exibido no aplicativo e no instalador é definido na hora de gerar o instalador. O padrão é **Nexus** ([ADR 0009](docs/decisions/0009-marca-configuravel.md)).

# 3. Conceito principal do aplicativo

O Nexus deve funcionar como um ambiente independente para cada usuário.

Cada pessoa instala o aplicativo em seu próprio computador e utiliza sua própria autenticação do Claude Code.

O aplicativo não será um serviço centralizado nem dependerá de uma infraestrutura de nuvem própria na primeira versão.

Os dados, documentos, configurações e conhecimentos serão armazenados localmente.

A proposta é permitir que o usuário tenha diferentes ambientes de trabalho, cada um com suas próprias informações e contexto.

## Exemplos de utilização

### Workspace: Trabalho

Pode conter:
- Processos e rotinas.
- Rotinas e procedimentos.
- Documentações internas.
- Projetos de automação.
- Sistemas desenvolvidos.
- Anotações e decisões.
- Conversas relacionadas ao trabalho.

### Workspace: Pessoal

Pode conter:
- Planejamento pessoal.
- Anotações.
- Estudos.
- Organização de tarefas.
- Ideias e projetos pessoais.

### Workspace: Desenvolvimento

Pode conter:
- Projetos de programação.
- Documentação técnica.
- Repositórios.
- Arquiteturas.
- Histórico de decisões.
- Conhecimentos sobre linguagens e ferramentas.

Esses são apenas exemplos. O aplicativo deve ser genérico e permitir que qualquer usuário crie seus próprios Workspaces, independentemente de profissão ou área de atuação.

# 4. Estrutura dos Workspaces

Os Workspaces serão uma das funcionalidades mais importantes do Nexus.

Cada Workspace deverá funcionar como um ambiente independente, com seu próprio contexto.

Cada um deverá possuir:

- Nome e identificação visual.
- Instruções específicas para a IA.
- Conhecimentos e anotações.
- Projetos associados.
- Conversas e histórico.
- Diretórios de trabalho.
- Configurações próprias.

Exemplo:

```text
NEXUS
│
├── Workspace: Trabalho
│   ├── Instruções
│   ├── Conhecimentos
│   │   ├── Processos
│   │   ├── Procedimentos
│   │   └── Anotações
│   ├── Projetos
│   │   ├── HYLIAN
│   │   └── Automação Bancária
│   └── Conversas
│
├── Workspace: Pessoal
│   ├── Instruções
│   ├── Conhecimentos
│   ├── Projetos
│   └── Conversas
│
└── Workspace: Desenvolvimento
    ├── Instruções
    ├── Conhecimentos
    ├── Projetos
    └── Conversas
```

A separação precisa ser real, não apenas visual.

Ao alternar entre Workspaces, o aplicativo deverá garantir que a IA esteja trabalhando com o contexto, os diretórios e as sessões corretas.

Uma conversa do Workspace Trabalho não deve utilizar automaticamente o contexto de um Workspace Pessoal, por exemplo.

# 5. Sistema de conhecimento — Segundo cérebro

O segundo pilar do Nexus será a organização de conhecimentos.

A ideia é utilizar arquivos Markdown (`.md`) organizados em pastas.

O usuário poderá criar notas, documentações, registros e conhecimentos que permanecerão disponíveis mesmo depois de encerrar o aplicativo ou iniciar novas conversas.

Exemplo:

```text
Conhecimentos/
│
├── Processos/
│   ├── Fechamento-Mensal.md
│   └── Conciliacao-Bancaria.md
│
├── Sistemas/
│   ├── HYLIAN.md
│   └── Mercado-Livre.md
│
├── Estudos/
│   └── JavaScript.md
│
└── Anotacoes/
    └── Ideias.md
```

A IA deverá conseguir consultar esses conhecimentos quando forem relevantes para uma solicitação.

É importante que o sistema não dependa exclusivamente do histórico das conversas para preservar informações.

O conhecimento deve existir de maneira estruturada e persistente, podendo ser consultado, editado e organizado pelo próprio usuário.

### Funcionalidades previstas

- Criar e editar notas Markdown.
- Organizar notas em pastas.
- Consultar documentos.
- Relacionar conhecimentos a projetos e Workspaces.
- Permitir que a IA consulte informações relevantes.
- Preservar informações importantes entre diferentes sessões.

Uma visualização em grafo, semelhante ao Obsidian, pode ser considerada futuramente, mas não é prioridade para a primeira versão.

# 6. Interface e experiência do usuário

A interface deve ter o chat como elemento central.

A inspiração visual e funcional vem de ferramentas como Cursor e VS Code, mas com uma experiência mais orientada à conversa.

A estrutura inicial pode ser:

```text
┌─────────────────────────────────────────────────────────────┐
│ NEXUS                              Workspace: Trabalho│
├──────────────┬──────────────────────────────┬────────────────┤
│              │                              │                │
│ WORKSPACES   │           CHAT               │ ARQUIVOS       │
│              │                              │                │
│ Trabalho   │  Conversa com a IA           │ Projetos       │
│ Pessoal      │                              │                │
│ Desenvolv.   │                              │ Conhecimentos  │
│              │                              │                │
│              │                              │                │
│              │                              │                │
│              │                              │                │
│              ├──────────────────────────────┤                │
│              │ Escreva sua mensagem...      │                │
│              └──────────────────────────────┘                │
└─────────────────────────────────────────────────────────────┘
```

Essa é apenas uma referência conceitual, não uma interface definitiva.

### Diretrizes de interface

- Visual moderno, limpo e profissional.
- Chat como principal elemento da tela.
- Sidebar para navegação entre Workspaces e projetos.
- Painel secundário para arquivos e conhecimentos.
- Possibilidade de abrir documentos sem abandonar a conversa.
- Interface responsiva ao tamanho da janela.
- Boa utilização do espaço disponível.
- Animações discretas e transições suaves.
- Suporte a temas escuro e claro, se viável.

O aplicativo não deve parecer um editor de código tradicional. O usuário precisa sentir que está entrando em um ambiente inteligente de trabalho.

# 7. Integração com Claude Code

Este é um dos pontos técnicos mais importantes do projeto.

O Nexus utilizará o **Claude Code CLI oficial** como motor de inteligência e execução.

O usuário já possui o Claude Code instalado e deverá conseguir utilizar sua autenticação existente.

A proposta é que o Nexus funcione como uma interface e camada de organização sobre o Claude Code.

Não queremos recriar o Claude Code, fazer um fork ou implementar uma integração artificial por simulação de teclado e mouse.

Também não queremos utilizar diretamente a API da Anthropic nesta primeira versão.

### Comportamento esperado

O aplicativo deverá:

1. Verificar se o Claude Code está instalado.
2. Identificar se existe autenticação válida.
3. Permitir iniciar uma conversa.
4. Enviar mensagens ao Claude Code.
5. Receber respostas em tempo real.
6. Exibir o conteúdo de maneira organizada.
7. Preservar o histórico das conversas.
8. Permitir continuidade de sessões quando suportado pela CLI.
9. Permitir que o Claude Code leia, crie e modifique arquivos nos diretórios autorizados.

### Streaming

As respostas devem aparecer progressivamente, sem que o usuário precise esperar a conclusão de toda a resposta.

A experiência deve ser semelhante à de um chat moderno.

### Execução de comandos

O Nexus deverá permitir que o Claude Code execute tarefas reais nos projetos, respeitando os mecanismos de permissão e segurança do próprio Claude Code.

Não utilizar `--dangerously-skip-permissions` como configuração padrão.

### Contexto da IA

A organização do contexto deverá ocorrer em três níveis:

**Global**
- Preferências gerais.
- Instruções permanentes.
- Regras gerais de comportamento.

**Workspace**
- Instruções específicas daquele ambiente.
- Conhecimentos relacionados.
- Preferências e informações próprias.

**Projeto**
- Arquivos.
- Documentação.
- Decisões técnicas.
- Estrutura e informações específicas do projeto.

O sistema deverá enviar ou disponibilizar o contexto adequado ao Claude Code, evitando misturar informações entre ambientes.

# 8. Arquitetura técnica proposta

A arquitetura inicial sugerida é:

### Aplicativo desktop

**Electron**

Responsável por executar o aplicativo como um programa nativo no Windows.

### Interface

- React
- TypeScript
- Vite
- Tailwind CSS
- Lucide Icons

### Backend local

Node.js integrado ao Electron.

Responsável por:
- Gerenciamento dos Workspaces.
- Gerenciamento das conversas.
- Integração com Claude Code CLI.
- Leitura e escrita de arquivos.
- Gerenciamento de sessões.
- Controle de permissões.
- Comunicação com a interface.

### Banco de dados

SQLite.

Utilizado para armazenar:
- Workspaces.
- Conversas.
- Mensagens.
- Configurações.
- Metadados de projetos.
- Referências aos documentos.

Os arquivos de conhecimento propriamente ditos serão armazenados em Markdown, não exclusivamente dentro do banco de dados.

### Armazenamento

Os dados serão armazenados localmente no computador do usuário, preferencialmente dentro do diretório de dados da aplicação.

Exemplo conceitual:

```text
Nexus/
│
├── database/
│   └── nexus.db
│
├── Workspaces/
│   ├── Trabalho/
│   │   ├── workspace.md
│   │   ├── Conhecimentos/
│   │   ├── Projetos/
│   │   └── Conversas/
│   │
│   └── Pessoal/
│       ├── workspace.md
│       ├── Conhecimentos/
│       ├── Projetos/
│       └── Conversas/
│
└── settings/
    └── preferences.json
```

Essa estrutura é uma proposta inicial e poderá ser refinada durante o desenvolvimento.

# 9. Segurança e privacidade

A segurança deve ser considerada desde a primeira versão.

Diretrizes:

- Não armazenar tokens de autenticação do Claude no banco de dados do Nexus.
- Utilizar a autenticação oficial já configurada pelo Claude Code.
- Não expor funcionalidades privilegiadas do Node.js diretamente ao renderer.
- Utilizar IPC controlado por meio do preload.
- Validar caminhos de arquivos e operações executadas.
- Isolar corretamente os Workspaces.
- Respeitar as permissões do Claude Code.
- Não executar comandos perigosos automaticamente sem autorização.

**Importante:** o armazenamento local não significa que o processamento da IA seja local.

Os conteúdos enviados ao Claude Code podem ser transmitidos e processados pela infraestrutura da Anthropic, conforme o funcionamento e as políticas do serviço.

O usuário deverá considerar isso ao utilizar informações confidenciais ou dados profissionais.

# 10. Escopo do MVP — Primeira versão

O objetivo inicial não é desenvolver todas as funcionalidades imaginadas.

Precisamos construir uma primeira versão funcional que prove que a arquitetura é viável.

O MVP deverá priorizar quatro pilares:

### 1. Aplicativo desktop funcional

- Abrir normalmente no Windows.
- Interface inicial bem estruturada.
- Navegação entre telas.
- Persistência local.

### 2. Chat funcional com Claude Code

- Detectar instalação.
- Verificar autenticação.
- Enviar mensagens.
- Receber respostas em streaming.
- Manter sessões.
- Permitir execução de tarefas em diretórios autorizados.

### 3. Workspaces

- Criar Workspace.
- Listar Workspaces.
- Alternar entre eles.
- Salvar configurações próprias.
- Manter diretórios e contextos separados.

### 4. Conhecimentos

- Criar notas Markdown.
- Editar notas.
- Listar e organizar documentos.
- Salvar informações permanentemente.
- Permitir que a IA consulte o conhecimento relevante.

**Critério de sucesso do MVP:** conseguir abrir o Nexus, selecionar um Workspace, conversar com o Claude Code dentro daquele ambiente, trabalhar em arquivos e manter conhecimentos persistentes entre sessões.

# 11. Funcionalidades para versões futuras

Depois que o MVP estiver estável, podemos desenvolver:

- Gerenciamento avançado de projetos.
- Histórico completo e busca de conversas.
- Editor Markdown integrado.
- Visualização de arquivos e código.
- Busca contextual nos conhecimentos.
- Indexação de documentos.
- Relacionamento entre notas.
- Visualização em grafo.
- Anexos e leitura de PDFs.
- Melhorias na gestão de contexto.
- Painel de tarefas.
- Atalhos e comandos rápidos.
- Integrações com ferramentas externas.
- Sistema de backup e exportação.
- Sincronização entre dispositivos, caso faça sentido futuramente.

Não precisamos implementar tudo isso agora.

# 12. Estratégia de desenvolvimento

O desenvolvimento deverá ser dividido em etapas pequenas e verificáveis.

**Etapa 1 — Fundação**
- Criar estrutura do projeto.
- Configurar Electron, React, TypeScript e Vite.
- Configurar comunicação segura entre frontend e backend.
- Criar a janela principal.
- Preparar persistência local.

**Etapa 2 — Workspaces**
- Criar e listar ambientes.
- Implementar alternância.
- Criar diretórios independentes.
- Implementar instruções próprias.

**Etapa 3 — Integração Claude Code**
- Detectar a CLI.
- Validar autenticação.
- Implementar execução de processos.
- Implementar streaming.
- Implementar gerenciamento de sessões.
- Testar permissões e isolamento.

**Etapa 4 — Sistema de conhecimento**
- Criar e editar Markdown.
- Organizar pastas.
- Integrar consulta dos conhecimentos ao contexto da IA.

**Etapa 5 — Refinamento**
- Histórico de conversas.
- Melhorias de interface.
- Tratamento de erros.
- Testes.
- Empacotamento e instalação no Windows.

Cada etapa deve ser testada antes de avançar para a seguinte.

# 13. Diretrizes importantes para o desenvolvimento com Claude Code

O Claude Code deverá atuar como principal agente de desenvolvimento do Nexus.

Algumas orientações importantes:

1. Não tentar desenvolver o aplicativo inteiro de uma vez.
2. Não criar funcionalidades fictícias apenas para preencher a interface.
3. Não utilizar dados simulados como se fossem dados reais.
4. Priorizar uma arquitetura organizada e de fácil manutenção.
5. Separar frontend, backend, serviços e persistência.
6. Evitar concentrar toda a lógica em arquivos gigantes.
7. Documentar decisões técnicas relevantes.
8. Testar cada funcionalidade implementada.
9. Não substituir tecnologias ou decisões importantes sem explicar os motivos.
10. Preservar a identidade visual e a proposta original do produto.

Antes de implementar cada etapa, o Claude Code deverá analisar a estrutura existente, explicar brevemente o que pretende fazer e depois executar as alterações.

Se encontrar problemas arquiteturais, deverá apresentar a solução recomendada antes de realizar mudanças estruturais grandes.

---

# 14. Objetivo final

O Nexus não deve ser apenas um aplicativo para conversar com inteligência artificial.

A visão é construir um ambiente pessoal de inteligência e produtividade.

Um lugar onde o usuário possa desenvolver projetos, armazenar conhecimentos, consultar informações, automatizar tarefas e trabalhar com IA sem perder o contexto entre diferentes atividades.

A combinação entre o poder de execução do Claude Code e uma estrutura persistente de conhecimentos e Workspaces deve ser o grande diferencial do produto.

**NEXUS — Your mind, connected.**

*Um núcleo inteligente que conecta ideias, conhecimento e possibilidades.*