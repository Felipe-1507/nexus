import { Code2, FileText, Orbit } from 'lucide-react';
import type { ReactNode } from 'react';
import { ErrorBoundary, PanelError } from '@renderer/components/ErrorBoundary';
import { GalaxyScreen } from '@renderer/features/galaxy/GalaxyScreen';
import { NotesPanel } from '@renderer/features/knowledge/NotesPanel';
import { cn } from '@renderer/lib/cn';
import { CodeScreen } from './CodeScreen';
import { activeRightTab, rightTabsFor, type RightTabId } from './layout';
import { useLayout } from './layout-store';

const allTabs: Array<{ id: RightTabId; label: string; icon: ReactNode }> = [
  { id: 'note', label: 'Nota', icon: <FileText size={14} /> },
  { id: 'code', label: 'Código', icon: <Code2 size={14} /> },
  { id: 'galaxy', label: 'Galáxia', icon: <Orbit size={14} /> },
];

export function RightPanel({ width }: { width: number }) {
  const preferred = useLayout((s) => s.rightTab);
  const setTab = useLayout((s) => s.setRightTab);
  const view = useLayout((s) => s.view);
  // O que está no centro (código ou galáxia) não se repete aqui.
  const available = rightTabsFor(view);
  const tabs = allTabs.filter((t) => available.includes(t.id));
  const active = activeRightTab(preferred, view);

  return (
    <aside aria-label="Painel lateral" className="flex shrink-0 flex-col bg-surface" style={{ width }}>
      <div role="tablist" aria-label="Conteúdo do painel" className="flex gap-1 border-b border-border px-2 py-1.5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            type="button"
            id={`tab-${tab.id}`}
            aria-selected={active === tab.id}
            aria-controls="right-panel-content"
            onClick={() => setTab(tab.id)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors',
              'focus-visible:outline-2 focus-visible:outline-accent',
              active === tab.id ? 'bg-surface-2 text-text' : 'text-muted hover:text-text',
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>
      <div
        id="right-panel-content"
        role="tabpanel"
        aria-labelledby={`tab-${active}`}
        className="flex min-h-0 flex-1 flex-col"
      >
        {/* Um erro numa aba não derruba a conversa; trocar de aba tenta de novo. */}
        <ErrorBoundary key={active} fallback={(error, reset) => <PanelError error={error} reset={reset} />}>
          {active === 'note' && <NotesPanel />}
          {active === 'code' && <CodeScreen />}
          {active === 'galaxy' && <GalaxyScreen mode="panel" />}
        </ErrorBoundary>
      </div>
    </aside>
  );
}
