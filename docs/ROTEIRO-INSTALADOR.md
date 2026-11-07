# Roteiro manual do instalador

Para conferir o instalador num Windows "limpo", como a máquina pessoal, antes de considerar uma versão pronta. Os testes automáticos cobrem o resto (`npm run check`, `npm run test:e2e`, `npm run test:packaged`).

Gerar o instalador: `npm run dist`. O arquivo sai em `release\Nexus-<versão>-instalador.exe`.

## 1. Instalação
- [ ] Copiar o instalador para a máquina e abrir.
- [ ] Se o SmartScreen avisar ("O Windows protegeu o computador"), clicar em **Mais informações → Executar assim mesmo**. O aviso aparece porque o app não é assinado.
- [ ] O instalador está em português e **não pede administrador**.
- [ ] Os atalhos aparecem na área de trabalho e no menu Iniciar.

## 2. Primeira execução, sem o Claude Code
Pular esta parte se a máquina já tiver o Claude Code.
- [ ] O app abre com o aviso **"Antes de começar"**. Esc e clique fora não fecham o aviso; **Entendi** fecha.
- [ ] O chat mostra o passo a passo **"Conecte o Claude para conversar"**, e a barra lateral mostra "Claude não conectado".
- [ ] Notas e a aba Código já funcionam, mesmo sem o Claude.
- [ ] **Instalar** abre uma janela do PowerShell com o instalador oficial. Quando terminar, o passo 1 fica marcado sozinho, sem reiniciar o Nexus.
- [ ] **Entrar com a minha conta** abre o login do Claude Code, que continua no navegador. Ao concluir, o chat é liberado sozinho.

## 3. Uso básico
- [ ] Criar um Workspace. A pasta é criada em `C:\Users\<você>\Nexus`.
- [ ] Mandar uma mensagem. Aparece "Pensando…" e depois a resposta.
- [ ] Pedir para criar um arquivo. O cartão do arquivo aparece e abre o diff na aba Código. "Desfazer" funciona.
- [ ] Colar um print no campo de mensagem (Ctrl+V) e perguntar sobre ele. A miniatura aparece antes de enviar e dentro da mensagem.
- [ ] Enviar uma segunda mensagem enquanto o Claude responde: ela aparece "Na fila" e começa sozinha.
- [ ] Pedir "registra isso nas notas". A nota aparece na aba Nota.
- [ ] Abrir a **Galáxia** na barra lateral. As notas aparecem como planetas, e clicar num planeta abre a nota ao lado.
- [ ] Adicionar um projeto de uma pasta de rede (`\\servidor\...`). A árvore abre na aba Código.
- [ ] Fechar e abrir o app. O aviso de privacidade **não** volta, e as conversas continuam lá.

## 4. Atualização e desinstalação
- [ ] Instalar uma versão nova por cima da anterior. Os dados continuam lá.
- [ ] Desinstalar em Configurações do Windows → Aplicativos. `%APPDATA%\Nexus` e a pasta de conteúdo continuam lá.

## Se algo falhar
Os logs ficam em `%APPDATA%\Nexus\logs\main.log`. Também dá para abrir a pasta em Configurações → Pastas → Logs.
