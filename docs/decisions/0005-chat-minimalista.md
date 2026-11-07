# 0005: Chat minimalista por padrão

**Status:** aceita (2026-10-30)

## Decisão
- Enquanto trabalha, o chat mostra só **"Pensando…"**.
- Ao terminar, mostra a **resposta final** (que aparece aos poucos) e **cartões dos arquivos** criados ou alterados, que abrem no painel lateral.
- Ficam escondidos: o raciocínio, as chamadas de ferramenta, os arquivos e pastas consultados, os comandos, os diffs e as frases intermediárias ("vou ler o arquivo X").
- Um texto que termina em `tool_use` é tratado como intermediário e recolhido.
- Tudo fica salvo e acessível em **"Ver detalhes"**, que inclui o diff no Monaco.
- O modo **"Detalhado"** fica disponível nas configurações.
- O prompt orienta o Claude a responder de forma curta, sem colar código ou diff na resposta.

## Implementação (Etapa 9)
- **Diff por resposta:** o normalizador guarda, para cada arquivo que o Claude criou ou editou, o conteúdo de antes (o `originalFile` do primeiro Write/Edit) e o de depois (as edições aplicadas em sequência). Fica na tabela `file_changes` (migração 0007), com limite de 1 milhão de caracteres por arquivo. Acima disso, só a indicação de que é grande demais.
- **Cartões de arquivo:** as notas abrem na aba Nota. Os demais arquivos abrem o diff daquela resposta na aba Código, com "Ver arquivo atual" e "Abrir no VS Code". Respostas anteriores à Etapa 9 não têm diff guardado e avisam isso.
- **Aba Código:**
  - árvore da pasta do escopo atual (projeto ou Workspace), lida pasta por pasta conforme é aberta, sem `.git`, `node_modules`, pastas de build e `.nexus`;
  - arquivo aberto no Monaco, só leitura até clicar em "Editar"; Ctrl+S grava e recusa sobrescrever uma alteração feita por fora (mtime);
  - binários e arquivos acima de 2 MB não são abertos.
- **Segurança:** todo caminho passa por `resolveInsideReal` (léxico e `realpath`, junctions para fora recusadas) dentro da pasta do escopo. O projeto precisa ser do Workspace informado. "Abrir no VS Code" usa `vscode://file/` só com caminhos já conferidos.
- **Monaco local:** vem empacotado com o app, com os workers do próprio pacote e sem CDN (o CSP bloqueia, e o Nexus não carrega nada da internet). Ele só é carregado quando a aba Código abre. A checagem de tipos de TS/JS fica desligada, porque o arquivo é aberto sem o resto do projeto.

## Consequências
- O normalizador de eventos classifica cada evento (resposta, intermediário, ferramenta, raciocínio, permissão, arquivo alterado). É a interface que decide o que mostrar.
- O pedido de permissão é a única interrupção visível durante uma tarefa e precisa ser curto.
