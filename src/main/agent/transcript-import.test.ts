import { describe, expect, it } from 'vitest';
import {
  convertTranscript,
  selectNewMessages,
  type ImportedMessage,
  type TranscriptMessage,
} from './transcript-import';

const user = (uuid: string, content: unknown): TranscriptMessage => ({
  type: 'user',
  uuid,
  message: { role: 'user', content },
});
const assistant = (uuid: string, content: unknown[]): TranscriptMessage => ({
  type: 'assistant',
  uuid,
  message: { role: 'assistant', content },
});

describe('convertTranscript', () => {
  it('junta as respostas do assistente e deixa só o texto final visível', () => {
    const result = convertTranscript([
      user('u1', 'Qual o status do projeto?'),
      assistant('a1', [{ type: 'thinking', thinking: '...' }]),
      assistant('a2', [{ type: 'text', text: 'Vou olhar o README.' }]),
      assistant('a3', [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'C:\\p\\README.md' } }]),
      user('u2', [{ type: 'tool_result', tool_use_id: 't1', content: '...' }]),
      assistant('a4', [{ type: 'text', text: 'Está em produção.' }]),
      user('u3', [{ type: 'image' }, { type: 'text', text: 'E este print?' }]),
      assistant('a5', [{ type: 'text', text: 'É a tela de login.' }]),
    ]);
    expect(result).toEqual([
      { id: 'u1', role: 'user', content: 'Qual o status do projeto?', activities: [] },
      {
        id: 'a1',
        role: 'assistant',
        content: 'Está em produção.',
        activities: [
          { kind: 'intermediate', label: 'Vou olhar o README.' },
          { kind: 'tool', label: 'Leu README.md', detail: 'C:\\p\\README.md' },
        ],
      },
      { id: 'u3', role: 'user', content: '[imagem]\nE este print?', activities: [] },
      { id: 'a5', role: 'assistant', content: 'É a tela de login.', activities: [] },
    ]);
  });

  it('ignora subagentes e guarda só as últimas mensagens', () => {
    const transcript: TranscriptMessage[] = [];
    for (let i = 0; i < 50; i++) {
      transcript.push(user(`u${i}`, `pergunta ${i}`));
      transcript.push({ ...assistant(`s${i}`, [{ type: 'text', text: 'interno' }]), parent_tool_use_id: 'x' });
      transcript.push(assistant(`a${i}`, [{ type: 'text', text: `resposta ${i}` }]));
    }
    const result = convertTranscript(transcript, 10);
    expect(result).toHaveLength(10);
    expect(result.at(-1)).toMatchObject({ content: 'resposta 49' });
    expect(result.some((m) => m.content === 'interno')).toBe(false);
  });
});

describe('selectNewMessages', () => {
  const u = (id: string, content = `pergunta ${id}`): ImportedMessage => ({
    id,
    role: 'user',
    content,
    activities: [],
  });
  const a = (id: string, content = `resposta ${id}`): ImportedMessage => ({
    id,
    role: 'assistant',
    content,
    activities: [],
  });
  const known = (...items: Array<[string, 'user' | 'assistant']>) => items.map(([id, role]) => ({ id, role }));
  const ids = (list: ImportedMessage[]) => list.map((m) => m.id);

  it('traz só o que vem depois da última mensagem que o Nexus já tem', () => {
    const transcript = [u('u1'), a('a1'), u('u2'), a('a2'), u('u3'), a('a3')];
    expect(ids(selectNewMessages(transcript, known(['u1', 'user'], ['a1', 'assistant'])))).toEqual([
      'u2',
      'a2',
      'u3',
      'a3',
    ]);
  });

  it('rodar de novo, com tudo já trazido, não acrescenta nada', () => {
    const transcript = [u('u1'), a('a1'), u('u2'), a('a2')];
    const all = known(['u1', 'user'], ['a1', 'assistant'], ['u2', 'user'], ['a2', 'assistant']);
    expect(selectNewMessages(transcript, all)).toEqual([]);
  });

  it('não repete a resposta que o próprio Nexus gravou com id próprio', () => {
    // O Nexus mandou u2 (mesmo id) e guardou a resposta como "nexus-a2"; na transcrição ela é a2.
    const transcript = [u('u1'), a('a1'), u('u2'), a('a2'), u('u3'), a('a3')];
    const inNexus = known(['u1', 'user'], ['a1', 'assistant'], ['u2', 'user'], ['nexus-a2', 'assistant']);
    expect(ids(selectNewMessages(transcript, inNexus))).toEqual(['u3', 'a3']);
  });

  it('se o Nexus não guardou resposta para a pergunta dele, a da transcrição é trazida', () => {
    const transcript = [u('u1'), a('a1')];
    expect(ids(selectNewMessages(transcript, known(['u1', 'user'])))).toEqual(['a1']);
  });

  it('ignora o resumo de compactação, comandos e lembretes que o Claude Code grava como mensagem do usuário', () => {
    const transcript = [
      u('s1', 'This session is being continued from a previous conversation that ran out of context.'),
      u('s2', '<local-command-stdout>Compacted </local-command-stdout>'),
      u('s3', '<command-name>/compact</command-name>'),
      u('s4', '<system-reminder>lembrete</system-reminder>'),
      u('u9', 'pergunta de verdade'),
      a('a9'),
    ];
    expect(ids(selectNewMessages(transcript, []))).toEqual(['u9', 'a9']);
  });

  it('sem nenhuma mensagem em comum (histórico compactado), traz tudo o que a transcrição tem agora', () => {
    const transcript = [u('n1'), a('n2')];
    expect(ids(selectNewMessages(transcript, known(['velho1', 'user'], ['velho2', 'assistant'])))).toEqual([
      'n1',
      'n2',
    ]);
  });

  it('nunca insere no meio: o que é mais antigo que a última mensagem conhecida fica de fora', () => {
    const transcript = [u('u1'), a('a1'), u('u2'), a('a2'), u('u3')];
    expect(ids(selectNewMessages(transcript, known(['u2', 'user'], ['a2', 'assistant'])))).toEqual(['u3']);
  });
});
