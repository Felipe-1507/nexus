import type { ClaudeStatus } from '@shared/claude';

/**
 * Guarda o último diagnóstico do Claude Code. A primeira verificação começa junto com o app; as telas reutilizam
 * o resultado e só refazem a verificação quando o usuário pede.
 */
export class ClaudeStatusService {
  private current: Promise<ClaudeStatus> | null = null;

  constructor(private readonly detect: () => Promise<ClaudeStatus>) {}

  get(refresh = false): Promise<ClaudeStatus> {
    if (refresh || !this.current) {
      const run = this.detect();
      this.current = run;
      // Uma falha inesperada não fica presa no cache: a próxima chamada tenta de novo.
      run.catch(() => {
        if (this.current === run) this.current = null;
      });
    }
    return this.current;
  }
}
