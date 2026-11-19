import { create } from 'zustand';
import type { WelcomeDue } from '@shared/welcome';
import type { View } from '@renderer/app/shell/layout-store';

interface WelcomeState {
  /** Tela aberta: o que ela mostra e para onde voltar ao fechar. */
  current: { due: WelcomeDue; workspaceId: string; returnView: View } | null;
  open: (current: NonNullable<WelcomeState['current']>) => void;
  close: () => void;
}

export const useWelcome = create<WelcomeState>((set) => ({
  current: null,
  open: (current) => set({ current }),
  close: () => set({ current: null }),
}));
