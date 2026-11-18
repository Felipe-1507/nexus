import { useEffect } from 'react';
import { useSearch } from '@renderer/features/search/search-store';
import { useLayout } from './layout-store';

/** Atalhos globais: Ctrl+B (barra lateral), Ctrl+Alt+B (painel direito), Ctrl+Shift+F (buscar nas conversas), Ctrl+, (configurações), Esc (voltar ao chat). */
export function useShortcuts(): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const { toggleSidebar, toggleRight, setView, view } = useLayout.getState();
      const key = e.key.toLowerCase();
      if (e.ctrlKey && e.shiftKey && key === 'f') {
        useSearch.getState().show();
      } else if (e.ctrlKey && !e.shiftKey && key === 'b') {
        if (e.altKey) toggleRight();
        else toggleSidebar();
      } else if (e.ctrlKey && key === ',') {
        setView('settings');
      } else if (key === 'escape' && view === 'settings') {
        setView('chat');
      } else {
        return;
      }
      e.preventDefault();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
