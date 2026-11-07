import { Code2, Gauge, MessageSquare, Orbit, Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import { ClaudeStatusIndicator } from '@renderer/features/claude/ClaudeStatusIndicator';
import { UsageMeter } from '@renderer/features/claude/UsageMeter';
import { cn } from '@renderer/lib/cn';
import { useLayout } from './layout-store';
import { SidebarSections } from './SidebarSections';

export function Sidebar({ width }: { width: number }) {
  const view = useLayout((s) => s.view);
  const setView = useLayout((s) => s.setView);

  return (
    <nav aria-label="Navegação principal" className="flex shrink-0 flex-col bg-surface" style={{ width }}>
      <div className="space-y-0.5 px-3 pt-3 pb-1">
        <NavItem
          icon={<MessageSquare size={15} />}
          label="Chat"
          active={view === 'chat'}
          onClick={() => setView('chat')}
        />
        <NavItem icon={<Code2 size={15} />} label="Código" active={view === 'code'} onClick={() => setView('code')} />
        <NavItem
          icon={<Orbit size={15} />}
          label="Galáxia"
          active={view === 'galaxy'}
          onClick={() => setView('galaxy')}
        />
        <NavItem
          icon={<Gauge size={15} />}
          label="Sessões"
          active={view === 'sessions'}
          onClick={() => setView('sessions')}
        />
      </div>

      <SidebarSections />

      <div className="space-y-0.5 border-t border-border p-3">
        <UsageMeter />
        <ClaudeStatusIndicator />
        <NavItem
          icon={<Settings size={15} />}
          label="Configurações"
          active={view === 'settings'}
          onClick={() => setView('settings')}
        />
      </div>
    </nav>
  );
}

function NavItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors',
        'focus-visible:outline-2 focus-visible:outline-accent',
        active ? 'bg-accent-soft text-text' : 'text-muted hover:bg-surface-2 hover:text-text',
      )}
    >
      <span className={active ? 'text-accent' : undefined}>{icon}</span>
      {label}
    </button>
  );
}
