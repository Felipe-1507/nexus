import { create } from 'zustand';

/** Para onde levar o usuário depois de escolher um resultado da busca. */
export interface SearchTarget {
  conversationId: string;
  /** `null` = só abrir a conversa (o resultado foi o título). */
  messageId: string | null;
  /** Faz buscar a mesma mensagem duas vezes funcionar. */
  nonce: number;
}

interface SearchState {
  open: boolean;
  show: () => void;
  hide: () => void;
  target: SearchTarget | null;
  /** A conversa aberta rola até a mensagem e a destaca. */
  goTo: (conversationId: string, messageId: string | null) => void;
  /** Chamado pela conversa quando já mostrou a mensagem (ou desistiu dela). */
  done: (nonce: number) => void;
}

let counter = 0;

export const useSearch = create<SearchState>()((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
  target: null,
  goTo: (conversationId, messageId) => set({ target: { conversationId, messageId, nonce: ++counter } }),
  done: (nonce) => set((s) => (s.target?.nonce === nonce ? { target: null } : s)),
}));
