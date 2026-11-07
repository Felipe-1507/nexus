import { BRAND } from '@shared/brand';
import { PanelLeft, PanelRight } from 'lucide-react';
import { IconButton } from '@renderer/components/ui/IconButton';
import { WorkspaceAvatar } from '@renderer/features/workspaces/appearance';
import { useActiveWorkspace } from '@renderer/features/workspaces/queries';
import { useLayout } from './layout-store';

/** Barra de título própria. Os botões nativos da janela ficam à direita (titleBarOverlay). */
export function TitleBar({ sidebarVisible, rightVisible }: { sidebarVisible: boolean; rightVisible: boolean }) {
  const toggleSidebar = useLayout((s) => s.toggleSidebar);
  const toggleRight = useLayout((s) => s.toggleRight);
  const active = useActiveWorkspace();

  return (
    <header className="drag flex h-10 shrink-0 items-center gap-1 border-b border-border bg-titlebar pr-[148px] pl-2">
      <IconButton label="Alternar barra lateral (Ctrl+B)" active={sidebarVisible} onClick={toggleSidebar}>
        <PanelLeft size={16} />
      </IconButton>
      <div className="flex items-center gap-2 px-2">
        {BRAND.logo ? (
          <img src={BRAND.logo} alt="" className="h-4 w-auto" />
        ) : (
          <span className="size-2 rounded-full bg-accent shadow-[0_0_10px_var(--accent)]" />
        )}
        <span className="text-[13px] font-semibold tracking-tight">{BRAND.productName}</span>
      </div>
      <span className="text-xs text-border">/</span>
      <span className="flex min-w-0 items-center gap-1.5 px-1 text-xs text-muted" data-testid="titlebar-workspace">
        {active ? (
          <>
            <WorkspaceAvatar color={active.color} icon={active.icon} size="xs" />
            <span className="truncate text-text">{active.name}</span>
          </>
        ) : (
          'Nenhum Workspace'
        )}
      </span>
      <div className="ml-auto">
        <IconButton label="Alternar painel lateral (Ctrl+Alt+B)" active={rightVisible} onClick={toggleRight}>
          <PanelRight size={16} />
        </IconButton>
      </div>
    </header>
  );
}
