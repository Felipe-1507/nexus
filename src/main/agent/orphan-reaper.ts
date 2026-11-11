import { execFile } from 'node:child_process';

/** Marca que só os processos abertos pelo Nexus levam na linha de comando (ver `extraArgs` do SessionManager). */
export const NEXUS_PROCESS_MARK = '--system-prompt-snapshot';

export interface ProcessInfo {
  pid: number;
  parentPid: number;
  commandLine: string;
}

export interface ReaperDeps {
  list: () => Promise<ProcessInfo[]>;
  kill: (pid: number) => Promise<void>;
}

/**
 * Processos do Claude Code abertos pelo Nexus cujo pai (o Nexus que os abriu) não existe mais, por exemplo depois
 * de o Nexus ser finalizado à força. Processos de outras origens (VS Code, terminal) não levam a marca.
 */
export function findOrphans(all: ProcessInfo[], selfPid: number): ProcessInfo[] {
  const alive = new Set(all.map((p) => p.pid));
  return all.filter(
    (p) =>
      p.pid !== selfPid &&
      p.commandLine.includes(NEXUS_PROCESS_MARK) &&
      /claude/i.test(p.commandLine) &&
      !alive.has(p.parentPid),
  );
}

/** Encerra os órfãos (com a árvore de filhos) e devolve os PIDs encerrados. Nunca lança: é só uma limpeza. */
export async function reapOrphans(deps: ReaperDeps, selfPid = process.pid): Promise<number[]> {
  try {
    const orphans = findOrphans(await deps.list(), selfPid);
    const killed: number[] = [];
    for (const o of orphans) {
      try {
        await deps.kill(o.pid);
        killed.push(o.pid);
      } catch {
        // já terminou ou sem permissão: segue para o próximo
      }
    }
    return killed;
  } catch {
    return [];
  }
}

const LIST_SCRIPT =
  "Get-CimInstance Win32_Process | Select-Object @{n='pid';e={[int]$_.ProcessId}},@{n='parentPid';e={[int]$_.ParentProcessId}},@{n='commandLine';e={[string]$_.CommandLine}} | ConvertTo-Json -Compress";

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: 20_000 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    );
  });
}

/** Implementação real (Windows). */
export const systemReaperDeps: ReaperDeps = {
  async list() {
    if (process.platform !== 'win32') return [];
    const out = (await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', LIST_SCRIPT])).trim();
    if (!out) return [];
    const parsed = JSON.parse(out) as ProcessInfo | ProcessInfo[];
    return (Array.isArray(parsed) ? parsed : [parsed]).filter((p) => p.commandLine);
  },
  async kill(pid) {
    await run('taskkill.exe', ['/PID', String(pid), '/T', '/F']);
  },
};
