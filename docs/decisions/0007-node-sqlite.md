# 0007: SQLite nativo do Node (`node:sqlite`) no lugar de better-sqlite3 + Drizzle

**Status:** aceita (2026-10-30) · substitui a parte de SQLite da ADR 0002 e da seção 10 da arquitetura

## Contexto
O `better-sqlite3` é um módulo nativo. Ele precisa ser recompilado para a versão do Electron, e o binário recompilado deixa de funcionar no Node puro usado pelo Vitest. Isso gera atrito permanente nos testes e no empacotamento.

O Electron 45 traz o Node 24.22, cujo `node:sqlite` (`DatabaseSync`) foi testado na Etapa 1:
- SQLite 3.53;
- WAL;
- transações;
- JSON;
- **FTS5 com `remove_diacritics`**: "conciliacao" encontra "Conciliação".

Tudo funciona igual no Electron e no Node do Vitest.

## Decisão
- Usar `node:sqlite` (`DatabaseSync`), sem módulo nativo.
- Migrações em arquivos `.sql` numerados (`src/main/persistence/migrations/NNNN_nome.sql`), embutidos no bundle via `import.meta.glob` e aplicados pelo `migrator.ts`:
  - uma transação por migração;
  - recusa downgrade.
- Sem ORM: repositórios pequenos com SQL explícito e statements preparados, um por domínio.

## Consequências
- Nenhuma recompilação. Os testes unitários rodam o mesmo SQLite do app.
- O `node:sqlite` ainda é marcado como *release candidate* no Node 24. O acesso fica restrito a `src/main/persistence/`, então uma troca futura é localizada.
- SQL escrito à mão exige testes de repositório. Isso já é regra do projeto.
