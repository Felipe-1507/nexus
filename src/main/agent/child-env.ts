/**
 * Ambiente para processos do Claude Code iniciados pelo Nexus (Etapa 0, achado B):
 * - `CLAUDE_CODE_*` / `CLAUDECODE`: herdados quando o Nexus roda de dentro de uma sessão do Claude Code; fariam o
 *   filho carregar o contexto da IDE (~12 mil tokens a mais);
 * - `ANTHROPIC_API_KEY`: desviaria a cobrança do login da conta para a chave;
 * - `ELECTRON_RUN_AS_NODE`: sem efeito no claude.exe, mas não deve vazar do Electron para filhos.
 */
export function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([k]) =>
        !k.startsWith('CLAUDE_CODE_') &&
        k !== 'CLAUDECODE' &&
        k !== 'ANTHROPIC_API_KEY' &&
        k !== 'ELECTRON_RUN_AS_NODE',
    ),
  );
}
