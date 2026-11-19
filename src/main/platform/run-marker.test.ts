import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MARKER_FILE, startMarker, takePreviousMarker } from './run-marker';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-marker-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('marca de execução', () => {
  it('fechou direito: a marca some e a próxima abertura não vê queda', () => {
    const m = startMarker(dir);
    expect(fs.existsSync(path.join(dir, MARKER_FILE))).toBe(true);
    m.stop();
    expect(takePreviousMarker(dir)).toBeNull();
  });

  it('caiu: a próxima abertura recebe a marca com a última hora viva, uma vez só', () => {
    const t = new Date('2026-11-19T14:57:30Z');
    startMarker(dir, () => t); // sem chamar stop(): simula a queda
    const marker = takePreviousMarker(dir, () => false);
    expect(marker).toMatchObject({ pid: process.pid, lastAlive: '2026-11-19T14:57:30.000Z' });
    expect(takePreviousMarker(dir, () => false)).toBeNull();
  });

  it('marca de um Nexus que ainda está vivo não conta como queda', () => {
    startMarker(dir);
    expect(takePreviousMarker(dir, () => true)).toBeNull();
    expect(fs.existsSync(path.join(dir, MARKER_FILE))).toBe(true);
  });

  it('arquivo ilegível é ignorado', () => {
    fs.writeFileSync(path.join(dir, MARKER_FILE), '{quebrado');
    expect(takePreviousMarker(dir)).toBeNull();
  });
});
