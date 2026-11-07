import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeProjectDir, findTranscript, parseTranscriptTail, readTranscriptTail } from './transcript-tail';

const assistant = (over: Record<string, unknown> = {}, usage: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-11-04T16:30:26.445Z',
    isSidechain: false,
    message: {
      model: 'claude-sonnet-5-5',
      usage: { input_tokens: 2, cache_read_input_tokens: 447_578, cache_creation_input_tokens: 481, ...usage },
    },
    ...over,
  });

const boundary = JSON.stringify({
  type: 'system',
  subtype: 'compact_boundary',
  timestamp: '2026-11-04T17:00:00.000Z',
  compactMetadata: { trigger: 'auto', preTokens: 396_057, postTokens: 20_437 },
});

describe('parseTranscriptTail', () => {
  it('devolve o uso da última chamada à API', () => {
    const text = [assistant({}, { cache_read_input_tokens: 10 }), assistant()].join('\n');
    expect(parseTranscriptTail(text)).toEqual({
      kind: 'usage',
      usage: {
        model: 'claude-sonnet-5-5',
        input: 2,
        cacheRead: 447_578,
        cacheCreation: 481,
        at: '2026-11-04T16:30:26.445Z',
      },
    });
  });

  it('ignora subagentes, respostas sintéticas e linhas cortadas', () => {
    const text = [
      assistant({ timestamp: '2026-11-04T10:00:00.000Z' }),
      assistant({ isSidechain: true }),
      JSON.stringify({ type: 'assistant', timestamp: 't', message: { model: '<synthetic>', usage: {} } }),
      '{"type":"assistant","usage": corta',
      '',
    ].join('\n');
    const found = parseTranscriptTail(text);
    expect(found).toMatchObject({ kind: 'usage', usage: { at: '2026-11-04T10:00:00.000Z' } });
  });

  it('se uma compactação veio depois da última chamada, o contexto atual não foi medido', () => {
    expect(parseTranscriptTail([assistant(), boundary].join('\n'))).toEqual({
      kind: 'after-compaction',
      at: '2026-11-04T17:00:00.000Z',
      preTokens: 396_057,
      postTokens: 20_437,
    });
  });

  it('uma chamada depois da compactação vale de novo', () => {
    const after = assistant({ timestamp: '2026-11-04T18:00:00.000Z' }, { cache_read_input_tokens: 25_000 });
    expect(parseTranscriptTail([boundary, after].join('\n'))).toMatchObject({
      kind: 'usage',
      usage: { cacheRead: 25_000 },
    });
  });

  it('sem nenhuma chamada registrada, não há resultado', () => {
    expect(parseTranscriptTail('')).toBeNull();
    expect(parseTranscriptTail('{"type":"user"}\n{"type":"summary"}')).toBeNull();
  });
});

describe('arquivos de transcrição', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-tail-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('lê só o fim de um arquivo grande e descarta a linha cortada no começo', async () => {
    const file = path.join(dir, 's.jsonl');
    const filler = JSON.stringify({ type: 'user', text: 'x'.repeat(1000) });
    const lines = Array.from({ length: 4000 }, () => filler);
    fs.writeFileSync(file, [...lines, assistant()].join('\n') + '\n');
    expect(fs.statSync(file).size).toBeGreaterThan(2 * 1024 * 1024);
    expect(await readTranscriptTail(file)).toMatchObject({ kind: 'usage', usage: { cacheRead: 447_578 } });
  });

  it('amplia a janela quando a última chamada está longe do fim', async () => {
    const file = path.join(dir, 'longe.jsonl');
    const filler = JSON.stringify({ type: 'user', text: 'x'.repeat(1000) });
    const lines = Array.from({ length: 6000 }, () => filler); // ~6 MB depois da chamada
    fs.writeFileSync(file, [assistant(), ...lines].join('\n') + '\n');
    expect(await readTranscriptTail(file)).toMatchObject({ kind: 'usage' });
  });

  it('o nome da pasta de projeto troca tudo que não é letra ou número por "-"', () => {
    expect(encodeProjectDir(String.raw`\\servidor\c$\nome`)).toBe('--servidor-c--nome');
    expect(encodeProjectDir(String.raw`C:\dev\nexus`)).toBe('C--dev-nexus');
  });

  it('acha a sessão pelo caminho esperado e, se não achar, procurando nas pastas de projetos', () => {
    const projects = path.join(dir, 'projects');
    fs.mkdirSync(path.join(projects, 'C--dev-nexus'), { recursive: true });
    fs.mkdirSync(path.join(projects, 'outra-pasta-longa'), { recursive: true });
    const id = '11111111-1111-4111-8111-111111111111';
    const other = '22222222-2222-4222-8222-222222222222';
    fs.writeFileSync(path.join(projects, 'C--dev-nexus', `${id}.jsonl`), '{}');
    fs.writeFileSync(path.join(projects, 'outra-pasta-longa', `${other}.jsonl`), '{}');
    const opts = { home: dir, env: { CLAUDE_CONFIG_DIR: dir } as NodeJS.ProcessEnv };

    expect(findTranscript(id, String.raw`C:\dev\nexus`, opts)?.file).toBe(
      path.join(projects, 'C--dev-nexus', `${id}.jsonl`),
    );
    expect(findTranscript(other, String.raw`C:\dev\nexus`, opts)?.file).toBe(
      path.join(projects, 'outra-pasta-longa', `${other}.jsonl`),
    );
    expect(findTranscript('33333333-3333-4333-8333-333333333333', String.raw`C:\dev\nexus`, opts)).toBeNull();
  });
});
