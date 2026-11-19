import { z } from 'zod';
import type { WelcomeItem, WelcomeRecap } from '@shared/welcome';
import { foldText } from '../chat/search-text';

/**
 * Fatos do resumo de boas-vindas: o que mudou por sistema/projeto desde a última vez, montado só com dados locais
 * (commits, notas, conversas). O Claude, quando permitido, apenas reescreve estes fatos; sem ele (ou se falhar), o
 * mesmo texto sai por regras.
 */

export interface TopicFacts {
  topic: string;
  commits: string[];
  notes: string[];
  conversations: string[];
}

export interface FactSources {
  /** Projetos do Workspace, com os assuntos dos commits do período. */
  projects: { name: string; commits: string[] }[];
  /** Notas alteradas no período, com o sistema (pasta de primeiro nível; '' = notas soltas). */
  notes: { title: string; system: string }[];
  /** Conversas com atividade no período; `project` é o nome do projeto (`null` = conversa geral). */
  conversations: { title: string; project: string | null }[];
}

const MAX_TOPICS = 12;
const MAX_COMMITS = 15;
const MAX_NOTES = 12;
const MAX_CONVERSATIONS = 8;
const MAX_TEXT = 160;
const GENERAL = 'Geral';

/** Chave para juntar "NOME", "nome" e "Filtros_MercadoTurbo" com "filtros mercadoturbo". */
export function topicKey(name: string): string {
  return foldText(name).replace(/[^a-z0-9]/g, '');
}

const clip = (text: string) => {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > MAX_TEXT ? `${one.slice(0, MAX_TEXT - 1)}…` : one;
};

/** Junta o que mudou por tema. Temas sem nada somem; os com mais mudanças vêm primeiro. */
export function buildTopics(sources: FactSources): TopicFacts[] {
  const topics = new Map<string, TopicFacts>();
  const get = (name: string): TopicFacts => {
    const key = topicKey(name) || 'geral';
    let topic = topics.get(key);
    if (!topic) {
      topic = { topic: name, commits: [], notes: [], conversations: [] };
      topics.set(key, topic);
    }
    return topic;
  };
  for (const p of sources.projects) {
    const t = get(p.name);
    for (const c of p.commits) if (c.trim() && !/^merge\b/i.test(c)) t.commits.push(clip(c));
  }
  for (const n of sources.notes) get(n.system || 'Notas gerais').notes.push(clip(n.title));
  for (const c of sources.conversations) {
    if (c.title.trim()) get(c.project ?? GENERAL).conversations.push(clip(c.title));
  }
  const size = (t: TopicFacts) => t.commits.length + t.notes.length + t.conversations.length;
  return [...topics.values()]
    .filter((t) => size(t) > 0)
    .sort((a, b) => size(b) - size(a) || a.topic.localeCompare(b.topic, 'pt-BR'))
    .slice(0, MAX_TOPICS);
}

export function countsOf(topics: TopicFacts[]): WelcomeRecap['counts'] {
  return {
    commits: topics.reduce((n, t) => n + t.commits.length, 0),
    notes: topics.reduce((n, t) => n + t.notes.length, 0),
    conversations: topics.reduce((n, t) => n + t.conversations.length, 0),
  };
}

/** Texto enviado ao Claude: só os fatos, curtos (alguns KB no máximo). */
export function factsPrompt(topics: TopicFacts[], sinceLabel: string): string {
  const lines = [`Período: ${sinceLabel.toLowerCase()} até agora.`, ''];
  for (const t of topics) {
    lines.push(`## ${t.topic}`);
    if (t.commits.length > 0) lines.push(`Commits: ${t.commits.slice(0, MAX_COMMITS).join(' | ')}`);
    if (t.notes.length > 0) lines.push(`Notas alteradas: ${t.notes.slice(0, MAX_NOTES).join(' | ')}`);
    if (t.conversations.length > 0) {
      lines.push(`Conversas: ${t.conversations.slice(0, MAX_CONVERSATIONS).join(' | ')}`);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

export const RECAP_SYSTEM_PROMPT = [
  'Você escreve o resumo de boas-vindas de um app pessoal de notas e projetos.',
  'Receberá, por tema (um sistema ou projeto), o que mudou desde a última abertura: commits, notas alteradas e conversas.',
  'Para cada tema escreva 1 ou 2 frases curtas, em português do Brasil e em linguagem simples, dizendo o que foi feito (funções novas, correções, decisões).',
  'Use somente o que está nos dados: não invente nada e não cite números que não estejam lá. Não repita o nome do tema no texto.',
  'Responda apenas com JSON, sem comentários: {"itens":[{"tema":"<nome exato do tema>","texto":"<frases>"}]}.',
].join(' ');

const summarySchema = z.object({
  itens: z.array(z.object({ tema: z.string(), texto: z.string() })),
});

/** Lê a resposta do Claude. Tolera cerca de código e texto em volta; resposta inválida = `null`. */
export function parseSummary(raw: string): Map<string, string> | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = summarySchema.safeParse(JSON.parse(raw.slice(start, end + 1)));
    if (!parsed.success) return null;
    const map = new Map<string, string>();
    for (const item of parsed.data.itens) {
      const text = item.texto.replace(/\s+/g, ' ').trim();
      if (text) map.set(topicKey(item.tema), text);
    }
    return map.size > 0 ? map : null;
  } catch {
    return null;
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const sample = (items: string[], n: number) => {
  const shown = items.slice(0, n).map((s) => `"${s.replace(/[.\s]+$/, '')}"`);
  return items.length > n ? `${shown.join(', ')} e mais ${items.length - n}` : shown.join(', ');
};

/** Resumo sem IA: conta e cita os primeiros assuntos de cada tipo. */
export function localText(t: TopicFacts): string {
  const parts: string[] = [];
  if (t.commits.length > 0) parts.push(`${plural(t.commits.length, 'commit', 'commits')}: ${sample(t.commits, 3)}`);
  if (t.notes.length > 0)
    parts.push(`${plural(t.notes.length, 'nota alterada', 'notas alteradas')}: ${sample(t.notes, 3)}`);
  if (t.conversations.length > 0) {
    parts.push(`${plural(t.conversations.length, 'conversa', 'conversas')}: ${sample(t.conversations, 2)}`);
  }
  return `${parts.join('. ')}.`;
}

/** Itens finais: o texto do Claude quando houver, e o local para o tema que ele deixou de fora. */
export function assembleItems(topics: TopicFacts[], summary: Map<string, string> | null): WelcomeItem[] {
  return topics.map((t) => ({ topic: t.topic, text: summary?.get(topicKey(t.topic)) ?? localText(t) }));
}
