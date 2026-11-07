import type { Activity } from '@shared/chat';
import { describeTool } from './turn-accumulator';

/** Mensagem de uma transcrição do Claude Code (formato de `getSessionMessages`). */
export interface TranscriptMessage {
  type: 'user' | 'assistant' | 'system';
  uuid: string;
  message: unknown;
  parent_tool_use_id?: string | null;
}

export interface ImportedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  activities: Activity[];
}

type Block = { type?: string; text?: string; name?: string; input?: Record<string, unknown> };

function blocks(message: unknown): Block[] {
  const content = (message as { content?: unknown } | null)?.content;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return Array.isArray(content) ? (content as Block[]) : [];
}

/**
 * Converte uma transcrição do Claude Code para o formato do chat minimalista:
 * - mensagens do usuário com texto (resultados de ferramentas não são mensagens do usuário);
 * - cada sequência de respostas do assistente vira uma mensagem: o último texto é a resposta, os anteriores e as
 *   ferramentas usadas viram atividades ("Ver detalhes").
 * Guarda só as últimas `limit` mensagens.
 */
export function convertTranscript(transcript: TranscriptMessage[], limit = 60): ImportedMessage[] {
  const out: ImportedMessage[] = [];
  let assistant: { id: string; texts: string[]; activities: Activity[] } | null = null;

  const flush = () => {
    if (!assistant) return;
    const final = assistant.texts.pop() ?? '';
    out.push({
      id: assistant.id,
      role: 'assistant',
      content: final.trim(),
      activities: [
        ...assistant.texts.map((t): Activity => ({ kind: 'intermediate', label: t.trim() })),
        ...assistant.activities,
      ],
    });
    assistant = null;
  };

  for (const m of transcript) {
    if (m.parent_tool_use_id) continue; // subagentes
    if (m.type === 'user') {
      const parts = blocks(m.message);
      const texts = parts
        .map((b) => (b.type === 'text' ? (b.text ?? '') : b.type === 'image' ? '[imagem]' : null))
        .filter((t): t is string => t !== null && t.trim().length > 0);
      if (texts.length === 0) continue; // só resultados de ferramentas
      flush();
      out.push({ id: m.uuid, role: 'user', content: texts.join('\n').trim(), activities: [] });
    } else if (m.type === 'assistant') {
      assistant ??= { id: m.uuid, texts: [], activities: [] };
      for (const b of blocks(m.message)) {
        if (b.type === 'text' && b.text?.trim()) assistant.texts.push(b.text);
        if (b.type === 'tool_use' && b.name) assistant.activities.push(describeTool(b.name, b.input ?? {}));
      }
    }
  }
  flush();
  return out.filter((m) => m.role === 'user' || m.content || m.activities.length).slice(-limit);
}

export interface KnownMessage {
  id: string;
  role: 'user' | 'assistant';
}

/** Mensagens "do usuário" que o Claude Code grava por conta própria (resumo de compactação, comandos, lembretes). */
const NOISE =
  /^\s*(This session is being continued|<local-command|<command-|<system-reminder>|<user-prompt-submit-hook>)/;

/**
 * Mensagens da transcrição que o Nexus ainda não tem, na ordem da conversa. Só entra o que vem **depois** da última
 * mensagem que o Nexus já possui (nada é inserido no meio). As mensagens do usuário têm o mesmo id nos dois lados, e a
 * resposta que o próprio Nexus gravou tem id próprio: se a pergunta já é do Nexus e ele já guardou uma resposta depois
 * dela, a resposta seguinte da transcrição é a mesma e não é repetida. Rodar de novo não acrescenta nada.
 */
export function selectNewMessages(transcript: ImportedMessage[], known: KnownMessage[]): ImportedMessage[] {
  const knownIds = new Set(known.map((m) => m.id));
  const clean = transcript.filter((m) => !(m.role === 'user' && NOISE.test(m.content)));
  let anchor = -1;
  clean.forEach((m, i) => {
    if (knownIds.has(m.id)) anchor = i;
  });
  let candidates = clean.slice(anchor + 1);
  const anchored = clean[anchor];
  if (anchored?.role === 'user') {
    const at = known.findIndex((k) => k.id === anchored.id);
    const hasReply = known.slice(at + 1).some((k) => k.role === 'assistant');
    if (hasReply && candidates[0]?.role === 'assistant') candidates = candidates.slice(1);
  }
  return candidates.filter((m) => !knownIds.has(m.id));
}
