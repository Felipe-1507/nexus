import { execFile } from 'node:child_process';

export type RunResult =
  | { ok: true; stdout: string; stderr: string }
  | { ok: false; reason: 'not_found' | 'timeout' | 'exit'; code: number | null; stdout: string; stderr: string };

export type Run = (
  file: string,
  args: string[],
  options: { timeoutMs: number; env: NodeJS.ProcessEnv },
) => Promise<RunResult>;

/** Executa um programa diretamente, sem shell (sem risco de injeção pelos argumentos). */
export const runFile: Run = (file, args, { timeoutMs, env }) =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, env, windowsHide: true, maxBuffer: 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (!error) return resolve({ ok: true, stdout, stderr });
        const e = error as NodeJS.ErrnoException & { killed?: boolean; code?: string | number };
        const reason = e.code === 'ENOENT' ? 'not_found' : e.killed ? 'timeout' : 'exit';
        resolve({ ok: false, reason, code: typeof e.code === 'number' ? e.code : null, stdout, stderr });
      },
    );
  });
