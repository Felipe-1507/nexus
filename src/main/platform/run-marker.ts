import fs from 'node:fs';
import path from 'node:path';

/**
 * Marca de "estou rodando": um arquivo pequeno que o Nexus atualiza de tempos em tempos e apaga ao fechar direito. Se na
 * próxima abertura ele ainda existir, a execução anterior terminou sem passar pelo encerramento normal (queda do
 * programa, do Windows ou da placa de vídeo) e o log diz até que horas ela esteve viva.
 */
export const MARKER_FILE = 'running.json';
export const MARKER_INTERVAL_MS = 30_000;

export interface Marker {
  pid: number;
  startedAt: string;
  lastAlive: string;
}

/** Lê a marca da execução anterior (e a apaga). `null` = a anterior fechou direito, ou não há marca legível. */
export function takePreviousMarker(dir: string, isAlive: (pid: number) => boolean = pidAlive): Marker | null {
  const file = path.join(dir, MARKER_FILE);
  let marker: Marker | null = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Marker>;
    if (
      typeof parsed.pid === 'number' &&
      typeof parsed.startedAt === 'string' &&
      typeof parsed.lastAlive === 'string'
    ) {
      marker = { pid: parsed.pid, startedAt: parsed.startedAt, lastAlive: parsed.lastAlive };
    }
  } catch {
    // sem marca anterior
  }
  // Outro Nexus ainda vivo com esse número: a marca é dele, não de uma queda.
  if (marker && isAlive(marker.pid)) return null;
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // não atrapalha
  }
  return marker;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Começa a marcar; devolve a função que apaga a marca (encerramento limpo). */
export function startMarker(dir: string, now: () => Date = () => new Date()): { stop: () => void } {
  const file = path.join(dir, MARKER_FILE);
  const startedAt = now().toISOString();
  const write = () => {
    try {
      fs.writeFileSync(file, JSON.stringify({ pid: process.pid, startedAt, lastAlive: now().toISOString() }));
    } catch {
      // disco cheio ou bloqueado: a marca é só diagnóstico
    }
  };
  write();
  const timer = setInterval(write, MARKER_INTERVAL_MS);
  timer.unref();
  return {
    stop: () => {
      clearInterval(timer);
      try {
        fs.rmSync(file, { force: true });
      } catch {
        // não atrapalha
      }
    },
  };
}
