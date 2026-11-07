import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { clamp, NO_SECTION_HEIGHTS, RIGHT_PANEL, SIDEBAR, type PanelState, type SectionHeights } from './layout';

export type View = 'chat' | 'code' | 'galaxy' | 'sessions' | 'workspace' | 'project' | 'settings';
export type RightTab = 'note' | 'code' | 'galaxy';
export type WorkspaceDialogTarget = { mode: 'create' } | { mode: 'edit'; id: string } | null;

interface LayoutState extends PanelState {
  view: View;
  rightTab: RightTab;
  workspaceDialog: WorkspaceDialogTarget;
  /** Nota aberta no painel lateral (caminho relativo ao vault do Workspace dela). */
  openedNote: { workspaceId: string; path: string } | null;
  /** Abre a nota no painel lateral, ao lado da conversa (`null` volta à lista de notas). */
  openNote: (workspaceId: string, path: string | null) => void;
  /** Arquivo aberto na aba Código (caminho relativo à pasta do escopo). */
  openedCode: { workspaceId: string; projectId: string | null; path: string } | null;
  /** Diff de um arquivo alterado pelo Claude numa resposta. */
  openedDiff: { workspaceId: string; messageId: string; path: string } | null;
  openCode: (target: { workspaceId: string; projectId: string | null; path: string } | null) => void;
  openDiff: (target: { workspaceId: string; messageId: string; path: string } | null) => void;
  setView: (view: View) => void;
  openCreateWorkspace: () => void;
  openEditWorkspace: (id: string) => void;
  closeWorkspaceDialog: () => void;
  toggleSidebar: () => void;
  toggleRight: () => void;
  setSidebarWidth: (width: number) => void;
  setRightWidth: (width: number) => void;
  setRightTab: (tab: RightTab) => void;
  /** Alturas das seções da barra lateral escolhidas arrastando os divisores (`null` = automática). */
  sectionHeights: SectionHeights;
  setSectionHeights: (heights: Partial<SectionHeights>) => void;
}

const CODE_MIN_WIDTH = 560;

function showCode(rightWidth: number) {
  return {
    rightTab: 'code' as const,
    rightOpen: true,
    rightWidth: clamp(Math.max(rightWidth, CODE_MIN_WIDTH), RIGHT_PANEL),
  };
}

// Preferências de layout são conveniência local: se o localStorage falhar, o app segue com os padrões.
const safeStorage = createJSONStorage(() => ({
  getItem: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      // sem persistência
    }
  },
  removeItem: (k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      // sem persistência
    }
  },
}));

export const useLayout = create<LayoutState>()(
  persist(
    (set) => ({
      view: 'chat',
      sidebarOpen: true,
      sidebarWidth: SIDEBAR.default,
      rightOpen: true,
      rightWidth: RIGHT_PANEL.default,
      rightTab: 'note',
      workspaceDialog: null,
      openedNote: null,
      openNote: (workspaceId, path) =>
        set(path ? { openedNote: { workspaceId, path }, rightTab: 'note', rightOpen: true } : { openedNote: null }),
      openedCode: null,
      openedDiff: null,
      // Código precisa de mais espaço que notas: abrir alarga o painel (sem passar do limite).
      // Com o Código no centro, o arquivo abre ali mesmo; fora dele, abre na aba Código do painel lateral.
      openCode: (target) =>
        set((s) =>
          target
            ? { openedCode: target, openedDiff: null, ...(s.view === 'code' ? {} : showCode(s.rightWidth)) }
            : { openedCode: null, openedDiff: null },
        ),
      openDiff: (target) =>
        set((s) =>
          target ? { openedDiff: target, ...(s.view === 'code' ? {} : showCode(s.rightWidth)) } : { openedDiff: null },
        ),
      setView: (view) => set({ view }),
      openCreateWorkspace: () => set({ workspaceDialog: { mode: 'create' } }),
      openEditWorkspace: (id) => set({ workspaceDialog: { mode: 'edit', id } }),
      closeWorkspaceDialog: () => set({ workspaceDialog: null }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      toggleRight: () => set((s) => ({ rightOpen: !s.rightOpen })),
      setSidebarWidth: (w) => set({ sidebarWidth: clamp(w, SIDEBAR) }),
      setRightWidth: (w) => set({ rightWidth: clamp(w, RIGHT_PANEL) }),
      setRightTab: (rightTab) => set({ rightTab, rightOpen: true }),
      sectionHeights: NO_SECTION_HEIGHTS,
      setSectionHeights: (heights) => set((s) => ({ sectionHeights: { ...s.sectionHeights, ...heights } })),
    }),
    {
      name: 'nexus.layout',
      version: 2,
      storage: safeStorage,
      // A v1 guardava a aba Galáxia de antes da Etapa 11; ela volta para Nota (a aba atual é outra).
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Omit<Partial<LayoutState>, 'rightTab'> & { rightTab?: string };
        if (version < 2 && state.rightTab === 'galaxy') state.rightTab = 'note';
        return state as LayoutState;
      },
      // A tela atual não é lembrada: o app sempre abre no chat.
      partialize: ({ sidebarOpen, sidebarWidth, rightOpen, rightWidth, rightTab, sectionHeights }) => ({
        sidebarOpen,
        sidebarWidth,
        rightOpen,
        rightWidth,
        rightTab,
        sectionHeights,
      }),
    },
  ),
);
