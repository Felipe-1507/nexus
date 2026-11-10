import { useEffect, useState } from 'react';
import { ErrorBoundary, PanelError } from '@renderer/components/ErrorBoundary';
import { ChatView } from '@renderer/features/chat/ChatView';
import { useChatEvents } from '@renderer/features/chat/queries';
import { SessionsOverview } from '@renderer/features/context/SessionsOverview';
import { useClaudeAutoCheck } from '@renderer/features/claude/queries';
import { UpdateNotices } from '@renderer/features/claude/UpdateNotices';
import { GalaxyScreen, usePrefetchGalaxy } from '@renderer/features/galaxy/GalaxyScreen';
import { useKnowledgeEvents } from '@renderer/features/knowledge/queries';
import { PrivacyNoticeHost } from '@renderer/features/privacy/PrivacyNotice';
import { SettingsView } from '@renderer/features/settings/SettingsView';
import { useAppearanceSync } from '@renderer/features/settings/queries';
import { WorkspaceDialogHost } from '@renderer/features/workspaces/WorkspaceDialog';
import { ProjectView } from '@renderer/features/projects/ProjectView';
import { WorkspaceView } from '@renderer/features/workspaces/WorkspaceView';
import { cn } from '@renderer/lib/cn';
import { CodeScreen } from './CodeScreen';
import { RIGHT_PANEL, SIDEBAR, visiblePanels } from './layout';
import { useLayout } from './layout-store';
import { Resizer } from './Resizer';
import { RightPanel } from './RightPanel';
import { Sidebar } from './Sidebar';
import { TitleBar } from './TitleBar';
import { useShortcuts } from './useShortcuts';

function useWindowWidth(): number {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}

export function Shell() {
  useShortcuts();
  useChatEvents();
  useKnowledgeEvents();
  useClaudeAutoCheck();
  usePrefetchGalaxy();
  useAppearanceSync();
  const windowWidth = useWindowWidth();
  const layout = useLayout();
  const [dragging, setDragging] = useState(false);
  const visible = visiblePanels(windowWidth, layout);
  // O painel de sessões é uma tabela larga e não tem relação com notas ou código: ocupa o espaço do painel lateral.
  const showRight = visible.right && layout.view !== 'sessions';

  return (
    <div className={cn('flex h-full flex-col', dragging && 'cursor-col-resize select-none')}>
      <TitleBar sidebarVisible={visible.sidebar} rightVisible={showRight} />
      <div className="flex min-h-0 flex-1">
        {visible.sidebar && (
          <>
            <Sidebar width={layout.sidebarWidth} />
            <div className="w-px shrink-0 bg-border" />
            <Resizer
              label="Redimensionar barra lateral"
              side="left"
              width={layout.sidebarWidth}
              min={SIDEBAR.min}
              max={visible.sidebarMax}
              defaultWidth={SIDEBAR.default}
              onResize={(w) => layout.setSidebarWidth(Math.min(w, visible.sidebarMax))}
              onDraggingChange={setDragging}
            />
          </>
        )}

        <main className="flex min-w-0 flex-1 flex-col bg-bg">
          <UpdateNotices />
          <ErrorBoundary key={layout.view} fallback={(error, reset) => <PanelError error={error} reset={reset} />}>
            {layout.view === 'settings' && <SettingsView />}
            {layout.view === 'workspace' && <WorkspaceView />}
            {layout.view === 'project' && <ProjectView />}
            {layout.view === 'chat' && <ChatView />}
            {layout.view === 'code' && <CodeScreen />}
            {layout.view === 'galaxy' && <GalaxyScreen mode="full" />}
            {layout.view === 'sessions' && <SessionsOverview />}
          </ErrorBoundary>
        </main>

        {showRight && (
          <>
            <Resizer
              label="Redimensionar painel lateral"
              side="right"
              width={visible.rightWidth}
              min={RIGHT_PANEL.min}
              max={visible.rightMax}
              defaultWidth={RIGHT_PANEL.default}
              // O arrasto para no espaço disponível: além dele, o chat ficaria espremido.
              onResize={(w) => layout.setRightWidth(Math.min(w, visible.rightMax))}
              onDraggingChange={setDragging}
            />
            <div className="w-px shrink-0 bg-border" />
            <RightPanel width={visible.rightWidth} />
          </>
        )}
      </div>
      <WorkspaceDialogHost />
      <PrivacyNoticeHost />
    </div>
  );
}
