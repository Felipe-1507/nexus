/** Regras puras do layout em três painéis (testáveis sem DOM). */

export const SIDEBAR = { min: 200, max: 420, default: 264 } as const;
export const RIGHT_PANEL = { min: 280, max: 720, default: 380 } as const;
/** Largura mínima que o chat precisa manter; abaixo disso os painéis laterais saem de cena. */
export const MIN_CENTER = 480;
/** Linha de 1 px entre cada painel lateral e o chat. */
export const DIVIDER = 1;

export function clamp(value: number, range: { min: number; max: number }): number {
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

export interface PanelState {
  sidebarOpen: boolean;
  sidebarWidth: number;
  rightOpen: boolean;
  rightWidth: number;
}

export interface FittedPanels {
  sidebar: boolean;
  right: boolean;
  /** Largura mostrada do painel direito: a preferida, limitada ao espaço que sobra. */
  rightWidth: number;
  /** Até onde o painel direito pode crescer sem apertar o chat (limite do arrasto). */
  rightMax: number;
  /** Até onde a barra lateral pode crescer sem esconder o painel direito nem apertar o chat. */
  sidebarMax: number;
}

/**
 * Decide o que cabe na janela sem alterar a preferência do usuário. Se faltar espaço, o painel direito primeiro
 * diminui até a largura mínima e só depois some; a barra lateral some por último. Ao alargar, tudo volta sozinho.
 * (Antes, um painel largo demais simplesmente sumia e ficava preso escondido, porque a largura fica salva.)
 */
export function visiblePanels(windowWidth: number, s: PanelState): FittedPanels {
  const sidebar = s.sidebarOpen && windowWidth - s.sidebarWidth - DIVIDER >= MIN_CENTER;
  const used = sidebar ? s.sidebarWidth + DIVIDER : 0;
  const rightMax = Math.min(RIGHT_PANEL.max, windowWidth - used - DIVIDER - MIN_CENTER);
  const right = s.rightOpen && rightMax >= RIGHT_PANEL.min;
  const rightWidth = Math.max(RIGHT_PANEL.min, Math.min(s.rightWidth, rightMax));
  const sidebarMax = Math.max(
    SIDEBAR.min,
    Math.min(SIDEBAR.max, windowWidth - DIVIDER - MIN_CENTER - (s.rightOpen ? RIGHT_PANEL.min + DIVIDER : 0)),
  );
  return { sidebar, right, rightWidth, rightMax, sidebarMax };
}

/** Telas principais que podem ocupar o centro; o que não está no centro fica nas abas do painel direito. */
export type MainView = 'chat' | 'code' | 'galaxy';
export type RightTabId = 'note' | 'code' | 'galaxy';

/**
 * Abas do painel direito para a tela do centro: Nota sempre; Código e Galáxia só quando não estão no centro.
 * O chat só existe no centro (precisa de largura para a conversa e o campo de mensagem).
 */
export function rightTabsFor(view: string): RightTabId[] {
  return (['note', 'code', 'galaxy'] as const).filter((tab) => tab !== view);
}

/** Aba mostrada: a preferida, se ela cabe; senão a primeira disponível (a preferida volta quando sair do centro). */
export function activeRightTab(preferred: RightTabId, view: string): RightTabId {
  const tabs = rightTabsFor(view);
  return tabs.includes(preferred) ? preferred : tabs[0]!;
}

/** Seções da barra lateral cuja altura o usuário pode ajustar; "Pastas" é a última e ocupa o que sobra. */
export type SectionKey = 'workspaces' | 'projects' | 'conversations';
/** Altura escolhida em px; `null` = automática (o tamanho de antes do ajuste). */
export type SectionHeights = Record<SectionKey, number | null>;
export const SECTION_MIN = 56;
export const FOLDERS_MIN = 72;
export const NO_SECTION_HEIGHTS: SectionHeights = { workspaces: null, projects: null, conversations: null };

/** Alturas reais (medidas na tela) das quatro seções no início do arrasto. */
export interface MeasuredSections {
  workspaces: number;
  projects: number;
  conversations: number;
  folders: number;
}

/**
 * Move o divisor `divider` (1 = Workspaces/Projetos, 2 = Projetos/Conversas, 3 = Conversas/Pastas) em `dy` px
 * (positivo = para baixo). Os dois primeiros trocam espaço entre as seções vizinhas; o último tira ou devolve
 * espaço às Pastas. Nenhuma seção fica menor que o mínimo.
 */
export function dragDivider(start: MeasuredSections, divider: 1 | 2 | 3, dy: number): Partial<SectionHeights> {
  const between = (above: number, below: number) => {
    const total = above + below;
    const next = Math.round(Math.min(total - SECTION_MIN, Math.max(SECTION_MIN, above + dy)));
    return [next, total - next] as const;
  };
  if (divider === 1) {
    const [workspaces, projects] = between(start.workspaces, start.projects);
    return { workspaces, projects };
  }
  if (divider === 2) {
    const [projects, conversations] = between(start.projects, start.conversations);
    return { projects, conversations };
  }
  const max = start.conversations + start.folders - FOLDERS_MIN;
  return {
    conversations: Math.round(Math.min(Math.max(SECTION_MIN, max), Math.max(SECTION_MIN, start.conversations + dy))),
  };
}
