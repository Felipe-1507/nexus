import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { ConversationList } from '@renderer/features/chat/ConversationList';
import { FolderSection } from '@renderer/features/projects/FolderSection';
import { ProjectList } from '@renderer/features/projects/ProjectList';
import { useActiveWorkspace } from '@renderer/features/workspaces/queries';
import { WorkspaceList } from '@renderer/features/workspaces/WorkspaceList';
import { dragDivider, FOLDERS_MIN, SECTION_MIN, type MeasuredSections } from './layout';
import { useLayout } from './layout-store';

type Divider = 1 | 2 | 3;
const LABELS: Record<Divider, string> = {
  1: 'Redimensionar entre Workspaces e Projetos',
  2: 'Redimensionar entre Projetos e Conversas',
  3: 'Redimensionar entre Conversas e Pastas',
};

/**
 * As quatro seções da barra lateral (Workspaces, Projetos, Conversas, Pastas) com divisores arrastáveis entre elas.
 * Sem ajuste, cada seção tem o tamanho automático de sempre; arrastar fixa a altura, que fica salva. Duplo clique
 * num divisor devolve as seções vizinhas ao tamanho automático.
 */
export function SidebarSections() {
  const workspace = useActiveWorkspace();
  const heights = useLayout((s) => s.sectionHeights);
  const setHeights = useLayout((s) => s.setSectionHeights);
  const refs = {
    workspaces: useRef<HTMLDivElement>(null),
    projects: useRef<HTMLDivElement>(null),
    conversations: useRef<HTMLDivElement>(null),
    folders: useRef<HTMLDivElement>(null),
  };
  const drag = useRef<{ y: number; start: MeasuredSections } | null>(null);

  // Sem Workspace ativo só existe a lista de Workspaces (com o convite para criar o primeiro).
  if (!workspace) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <WorkspaceList />
      </div>
    );
  }

  const measure = (): MeasuredSections => ({
    workspaces: refs.workspaces.current?.offsetHeight ?? 0,
    projects: refs.projects.current?.offsetHeight ?? 0,
    conversations: refs.conversations.current?.offsetHeight ?? 0,
    folders: refs.folders.current?.offsetHeight ?? 0,
  });

  const fixed = (h: number | null): CSSProperties | undefined =>
    h === null ? undefined : { height: h, flex: '0 1 auto', minHeight: SECTION_MIN };

  function reset(divider: Divider) {
    if (divider === 1) setHeights({ workspaces: null, projects: null });
    else if (divider === 2) setHeights({ projects: null, conversations: null });
    else setHeights({ conversations: null });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="sidebar-sections">
      <div
        ref={refs.workspaces}
        data-testid="section-workspaces"
        className="flex min-h-0 shrink-0 flex-col"
        style={fixed(heights.workspaces) ?? { maxHeight: '40%' }}
      >
        <WorkspaceList />
      </div>
      <Handle divider={1} measure={measure} drag={drag} onChange={setHeights} onReset={() => reset(1)} />
      <div
        ref={refs.projects}
        data-testid="section-projects"
        className="flex min-h-0 shrink-0 flex-col"
        style={fixed(heights.projects) ?? { maxHeight: 240 }}
      >
        <ProjectList />
      </div>
      <Handle divider={2} measure={measure} drag={drag} onChange={setHeights} onReset={() => reset(2)} />
      <div
        ref={refs.conversations}
        data-testid="section-conversations"
        className="flex min-h-0 flex-col"
        style={fixed(heights.conversations) ?? { flex: '1 1 0', minHeight: SECTION_MIN }}
      >
        <ConversationList />
      </div>
      <Handle divider={3} measure={measure} drag={drag} onChange={setHeights} onReset={() => reset(3)} />
      <div
        ref={refs.folders}
        data-testid="section-folders"
        className="flex min-h-0 flex-1 flex-col"
        style={{ minHeight: FOLDERS_MIN }}
      >
        <FolderSection />
      </div>
    </div>
  );
}

interface HandleProps {
  divider: Divider;
  measure: () => MeasuredSections;
  drag: RefObject<{ y: number; start: MeasuredSections } | null>;
  onChange: (heights: ReturnType<typeof dragDivider>) => void;
  onReset: () => void;
}

/** Divisor horizontal entre duas seções: arraste, setas (Shift = passo maior) ou duplo clique para restaurar. */
function Handle({ divider, measure, drag, onChange, onReset }: HandleProps) {
  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, start: measure() };
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (d) onChange(dragDivider(d.start, divider, e.clientY - d.y));
  }
  function onPointerUp() {
    drag.current = null;
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 48 : 16;
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    onChange(dragDivider(measure(), divider, e.key === 'ArrowUp' ? -step : step));
  }

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={LABELS[divider]}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      className="group relative z-10 h-0 shrink-0 cursor-row-resize outline-none before:absolute before:inset-x-0 before:-top-1 before:h-2"
    >
      <span className="absolute inset-x-0 -top-px h-0.5 bg-transparent transition-colors group-hover:bg-accent/50 group-focus-visible:bg-accent" />
    </div>
  );
}
