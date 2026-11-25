import type { ChatEvent } from '@shared/chat';

/** O que mostrar no aviso do Windows quando uma resposta termina (sem IA: só o título, o projeto e o começo do texto). */
export interface TurnNotice {
  title: string;
  body: string;
}

export interface TurnNoticeContext {
  /** Nome do projeto da conversa (null = conversas gerais do Workspace) e título da conversa. */
  projectName: string | null;
  conversationTitle: string;
}

const BODY_MAX = 140;

/**
 * Monta o aviso de "resposta pronta" para um fim de turno. Respostas interrompidas pelo usuário não avisam (ele já
 * sabe); erros avisam, para ele não ficar esperando à toa.
 */
export function turnNotice(event: ChatEvent, context: TurnNoticeContext): TurnNotice | null {
  if (event.type !== 'turn-end') return null;
  const { message } = event;
  if (message.status === 'interrupted') return null;
  const where = context.projectName ?? 'Geral';
  if (message.status === 'error') {
    return { title: `${where}: o Claude parou com erro`, body: firstLine(message.error ?? context.conversationTitle) };
  }
  return { title: `${where}: resposta pronta`, body: firstLine(message.content) || context.conversationTitle };
}

function firstLine(text: string): string {
  const line = text
    .split(/\r?\n/)
    .map((l) => l.replace(/[#*_`>]+/g, '').trim())
    .find((l) => l.length > 0);
  if (!line) return '';
  return line.length > BODY_MAX ? `${line.slice(0, BODY_MAX - 1)}…` : line;
}
