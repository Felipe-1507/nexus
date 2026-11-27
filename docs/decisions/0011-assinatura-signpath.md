# 0011: Instalador assinado pelo SignPath

**Status:** proposta (2026-11-27). Depende da aprovação do projeto pela SignPath Foundation.

## Contexto
- O instalador não é assinado. O Windows mostra "Editor desconhecido" e o SmartScreen ("O Windows protegeu o
  computador"), e o README ensina a passar por cima disso.
- Certificados pagos custam caro e, desde 2023, a chave precisa ficar em hardware ou na nuvem. O Azure Artifact
  Signing (antigo Trusted Signing) não atende pessoas físicas no Brasil.
- A versão base vai para o GitHub como código aberto, com licença MIT (`scripts/export-base.mjs`).

## Decisão
- Assinar pelo **SignPath Foundation**, grátis para projetos de código aberto. O certificado é da fundação, então o
  editor que aparece no Windows é "SignPath Foundation".
- O repositório público é a cópia gerada por `scripts/export-base.mjs` (um commit, sem histórico nem dados pessoais),
  nunca este repositório.
- O instalador é gerado e enviado para assinatura pelo GitHub Actions (`.github/workflows/instalador.yml`):
  - tag `vX.Y.Z` (igual à versão do `package.json`): política `release-signing`, com aprovação manual no SignPath, e
    um release no GitHub com o instalador assinado e o `nexus-update.json`;
  - execução manual: política `test-signing`, sem publicar.
- O `nexus-update.json` é calculado depois da assinatura: assinar muda o arquivo e, com ele, o SHA-512.
- Só o instalador NSIS é assinado (`.signpath/artifact-configuration.xml`). O `.exe` do app dentro dele fica sem
  assinatura; o SmartScreen confere o arquivo baixado.
- Política pública de assinatura, com equipe e privacidade: [CODE_SIGNING_POLICY.md](../../CODE_SIGNING_POLICY.md).
  A frase "Free code signing provided by SignPath.io, certificate by SignPath Foundation" aparece no README, no
  release e no site.

## Alternativas descartadas
- **Certificado autoassinado:** grátis, mas só vale nos computadores onde ele é instalado à mão.
- **Certum Open Source** (cerca de € 69 por ano): plano B se o SignPath recusar.
- **Azure Artifact Signing:** indisponível para pessoa física no Brasil.

## Riscos
- O SignPath pede que o projeto não tenha componentes proprietários. O instalador leva o
  `@anthropic-ai/claude-agent-sdk`, distribuído pela Anthropic sob os termos dela. Isso precisa ser informado no
  pedido. Se for um impedimento, as saídas são o Certum ou não empacotar o SDK.
- Mesmo assinado, o SmartScreen pode avisar nas primeiras versões, até o instalador ganhar reputação.

## Consequências
- Publicar uma versão passa a ser: subir a versão no `package.json`, commit na cópia pública, tag `vX.Y.Z`, aprovar o
  pedido no SignPath.
- Quando a primeira versão assinada sair, o passo do SmartScreen sai do README e do site.
