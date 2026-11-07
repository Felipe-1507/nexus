import { describe, expect, it } from 'vitest';
import {
  activeRightTab,
  dragDivider,
  FOLDERS_MIN,
  SECTION_MIN,
  clamp,
  RIGHT_PANEL,
  rightTabsFor,
  SIDEBAR,
  visiblePanels,
  type PanelState,
} from './layout';

const open: PanelState = { sidebarOpen: true, sidebarWidth: 264, rightOpen: true, rightWidth: 380 };

describe('clamp', () => {
  it('mantém as larguras dentro dos limites', () => {
    expect(clamp(50, SIDEBAR)).toBe(SIDEBAR.min);
    expect(clamp(9999, RIGHT_PANEL)).toBe(RIGHT_PANEL.max);
    expect(clamp(300.6, SIDEBAR)).toBe(301);
  });
});

describe('visiblePanels', () => {
  it('mostra tudo numa janela larga', () => {
    expect(visiblePanels(1440, open)).toMatchObject({ sidebar: true, right: true, rightWidth: 380 });
  });

  it('com pouco espaço, o painel direito diminui até o mínimo antes de sumir', () => {
    // 1100 - 264 (barra) - 480 (chat) - 2 (divisórias) = 354: cabe, menor que os 380 preferidos.
    expect(visiblePanels(1100, open)).toMatchObject({ sidebar: true, right: true, rightWidth: 354, rightMax: 354 });
    // 1000 - 264 - 480 - 2 = 254: nem o mínimo (280) cabe.
    expect(visiblePanels(1000, open)).toMatchObject({ sidebar: true, right: false });
  });

  it('um painel largo demais (largura salva) aparece limitado, em vez de sumir', () => {
    expect(visiblePanels(1440, { ...open, rightWidth: 720, sidebarWidth: 420 })).toMatchObject({
      right: true,
      rightWidth: 538,
      rightMax: 538,
    });
  });

  it('a barra lateral não cresce a ponto de esconder o painel direito', () => {
    expect(visiblePanels(1100, open).sidebarMax).toBe(1100 - 480 - RIGHT_PANEL.min - 2);
    expect(visiblePanels(1440, open).sidebarMax).toBe(SIDEBAR.max);
  });

  it('esconde a barra lateral só quando nem ela cabe', () => {
    expect(visiblePanels(700, open)).toMatchObject({ sidebar: false, right: false });
  });

  it('respeita painéis fechados pelo usuário', () => {
    expect(visiblePanels(1440, { ...open, sidebarOpen: false })).toMatchObject({ sidebar: false, right: true });
    expect(visiblePanels(1440, { ...open, rightOpen: false })).toMatchObject({ sidebar: true, right: false });
  });

  it('com a barra lateral fechada, sobra espaço para o painel direito', () => {
    expect(visiblePanels(1000, { ...open, sidebarOpen: false })).toMatchObject({ sidebar: false, right: true });
  });
});

describe('abas do painel direito', () => {
  it('esconde da lista o que está no centro e nunca coloca o chat no painel', () => {
    expect(rightTabsFor('chat')).toEqual(['note', 'code', 'galaxy']);
    expect(rightTabsFor('code')).toEqual(['note', 'galaxy']);
    expect(rightTabsFor('galaxy')).toEqual(['note', 'code']);
    expect(rightTabsFor('settings')).toEqual(['note', 'code', 'galaxy']);
  });

  it('usa a aba preferida quando ela cabe e cai para Nota quando está no centro', () => {
    expect(activeRightTab('code', 'chat')).toBe('code');
    expect(activeRightTab('code', 'code')).toBe('note');
    expect(activeRightTab('galaxy', 'galaxy')).toBe('note');
    expect(activeRightTab('note', 'code')).toBe('note');
  });
});

describe('divisores da barra lateral', () => {
  const start = { workspaces: 100, projects: 200, conversations: 150, folders: 250 };

  it('troca espaço entre as seções vizinhas sem mudar a soma', () => {
    expect(dragDivider(start, 1, 30)).toEqual({ workspaces: 130, projects: 170 });
    expect(dragDivider(start, 2, -50)).toEqual({ projects: 150, conversations: 200 });
  });

  it('o último divisor tira espaço das Pastas', () => {
    expect(dragDivider(start, 3, 60)).toEqual({ conversations: 210 });
  });

  it('respeita os mínimos de cada seção', () => {
    expect(dragDivider(start, 1, -500)).toEqual({ workspaces: SECTION_MIN, projects: 300 - SECTION_MIN });
    expect(dragDivider(start, 2, 500)).toEqual({ projects: 350 - SECTION_MIN, conversations: SECTION_MIN });
    expect(dragDivider(start, 3, 500)).toEqual({ conversations: 150 + 250 - FOLDERS_MIN });
    expect(dragDivider(start, 3, -500)).toEqual({ conversations: SECTION_MIN });
  });
});
