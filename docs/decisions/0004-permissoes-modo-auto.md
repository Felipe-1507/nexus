# 0004: Permissões com o modo Auto como padrão

**Status:** aceita (2026-10-30)

## Decisão
Cada Workspace tem um modo de permissão:

| Modo | Mapeamento no Claude Code |
|---|---|
| **Auto** (padrão) | `permissionMode: 'auto'`: um classificador libera as ações de rotina e bloqueia ou pergunta as arriscadas |
| Perguntar | `permissionMode: 'default'` + `canUseTool`, que abre um diálogo no Nexus |
| Somente leitura | ferramentas limitadas a leitura |

- Por Workspace, é possível liberar comandos específicos (ex.: `Bash(npm test:*)`).
- `bypassPermissions` / `--dangerously-skip-permissions` **nunca** são usados, e a interface não oferece essa opção.
- Pedido sem resposta, janela fechada ou tempo esgotado resultam em **negar**.
- Toda decisão fica registrada em `permission_audit`.
- **Desfazer:** usa o checkpoint de arquivos do próprio Claude Code (`enableFileCheckpointing` + `rewindFiles(uuid)`), validado na Etapa 0.
- **Somente leitura** é implementado com `disallowedTools` (Write, Edit, NotebookEdit, Bash, PowerShell), nunca com `tools` (ver o achado A do spike).

## Implementação (Etapa 6)
- **Política do Nexus** (`src/main/agent/permission-policy.ts`, função pura) decide cada `canUseTool` antes de perguntar:
  - leitura dentro das pastas do Workspace: liberada em qualquer modo. Isso resolve as pastas de rede, onde o Claude Code pergunta até para ler (achado H);
  - edição dentro do Workspace: liberada no Auto; no Perguntar, só com a regra "edições de arquivos";
  - comandos: liberados só por regra de prefixo (`npm test`). Comandos com `;`, `&&`, `|`, `>`, `` ` ``, `$(` ou quebra de linha **sempre** perguntam;
  - fora do Workspace: sempre pergunta.
- **Pedidos ao usuário** (`PermissionBroker`): sem resposta em 10 min, ao parar a conversa ou ao fechar o app, a resposta é **negar**. Negação por parada leva `interrupt: true`.
- **Auditoria** em `permission_audit`: decisões do usuário, por regra, por tempo esgotado e negações da política. Leituras liberadas pela política não são registradas, porque seriam milhares.
- **Desfazer:** só na última resposta que alterou arquivos. Antes de restaurar, mostra a lista de arquivos (`dryRun`). Funciona mesmo depois que o processo foi fechado (achado I). Comandos executados não são desfeitos.

## Consequências
- O Claude trabalha e entrega sem interrupções, como no modo Auto do Claude Code, mas mantém uma camada de segurança.
- O isolamento é de contexto e permissão, não um sandbox do sistema operacional.
