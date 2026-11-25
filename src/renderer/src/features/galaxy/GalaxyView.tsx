import {
  FileText,
  FolderOpen,
  Focus,
  LayoutDashboard,
  Orbit,
  Palette,
  Paperclip,
  Route,
  Search,
  SkipForward,
  Sparkles,
  X,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PALETTE } from '@shared/brand';
import { CHAT_EVENT_CHANNEL, type ChatEvent } from '@shared/chat';
import { KNOWLEDGE_EVENT_CHANNEL, type GalaxyGraph, type KnowledgeEvent } from '@shared/knowledge';
import { resolvePlanetStyle, type PlanetOverride } from '@shared/planets';
import { Button } from '@renderer/components/ui/Button';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { useLayout } from '@renderer/app/shell/layout-store';
import {
  useGalaxyGraph,
  useGalaxyStyles,
  useNote,
  useNoteLinks,
  useSetPlanetStyle,
} from '@renderer/features/knowledge/queries';
import { workspaceColors } from '@renderer/features/workspaces/appearance';
import { useActiveWorkspace } from '@renderer/features/workspaces/queries';
import { cn } from '@renderer/lib/cn';
import { invoke } from '@renderer/lib/ipc';
import { GalaxyScene } from './galaxy-scene';
import { layoutGalaxy, matchNotes, noteInVault, searchNotes } from './layout';
import { AUTO_STEPS, DEFAULT_GALAXY_QUALITY, GALAXY_PROFILES } from './quality';
import { useGalaxyLook, useGalaxyQuality } from '@renderer/features/settings/queries';
import { PlanetEditor } from './PlanetEditor';
import { MOON_COLORS, MOON_LABELS, moonKind, moonName } from './moon-effects';
import { describeStop, type TourStop } from './explore';
import { Highlighted } from '@renderer/features/search/Highlighted';
import { openSearchHit, useConversationSearch } from '@renderer/features/search/queries';
import type { SearchHit } from '@shared/search';
import { HomePanel } from './HomePanel';
import { notePreview } from './note-preview';
import { computeHomeStats } from './home-stats';
import { useChat } from '@renderer/features/chat/chat-store';
import type { Conversation } from '@shared/chat';

/** `full`: tela principal (clicar num planeta abre a nota). `panel`: aba do painel direito, ao lado do chat. */
export type GalaxyMode = 'full' | 'panel';

/** A galáxia do Workspace ativo em 3D. A nota escolhida abre no painel direito. */
export function GalaxyView({ mode = 'full' }: { mode?: GalaxyMode }) {
  const workspace = useActiveWorkspace();
  if (!workspace) {
    return (
      <EmptyState
        className={mode === 'panel' ? 'flex-1' : 'h-full'}
        icon={<Orbit size={18} />}
        title="Nenhum Workspace aberto"
        description="Cada Workspace tem a sua galáxia, formada pelas notas dele."
      />
    );
  }
  return (
    <Galaxy
      key={workspace.id}
      workspaceId={workspace.id}
      knowledgeDir={workspace.knowledgeDir}
      sun={{ name: workspace.name, color: workspaceColors[workspace.color].hex }}
      mode={mode}
    />
  );
}

function Galaxy({
  workspaceId,
  knowledgeDir,
  sun,
  mode,
}: {
  workspaceId: string;
  knowledgeDir: string;
  /** O sol do centro: o nome e a cor do Workspace. */
  sun: { name: string; color: string };
  mode: GalaxyMode;
}) {
  const panel = mode === 'panel';
  const graph = useGalaxyGraph(workspaceId);
  const openNote = useLayout((s) => s.openNote);
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<GalaxyScene | null>(null);
  const current = useRef<GalaxyGraph | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  // Exploração (G9): parada atual do tour e modo contemplativo.
  const [tour, setTour] = useState<{ index: number; total: number; stop: TourStop } | null>(null);
  const [contemplative, setContemplative] = useState(false);
  // Painel Home (GE1): números e atalhos sobre a galáxia. Só na tela principal; abrir e fechar não mexe na cena.
  const [home, setHome] = useState(false);
  const [awake, setAwake] = useState(true);
  const sleepTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openAttachment = useRef((note: string, name: string, reveal = false) => {
    setAttachmentError(null);
    invoke('knowledge:openAttachment', { workspaceId, note, name, reveal }).catch((err: unknown) =>
      setAttachmentError(err instanceof Error ? err.message : String(err)),
    );
  }).current;
  const overrides = useGalaxyStyles(workspaceId).data;
  const setPlanet = useSetPlanetStyle(workspaceId);
  // Aparência de cada planeta: o sorteio da nota com o que o usuário trocou por cima.
  const styles = useMemo(
    () => graph.data?.notes.map((n) => resolvePlanetStyle(n.path, overrides?.[n.path], n)) ?? null,
    [graph.data, overrides],
  );
  const layout = useMemo(
    () => (graph.data ? layoutGalaxy(graph.data, Date.now(), PALETTE.galaxy) : null),
    [graph.data],
  );
  current.current = graph.data ?? null;
  const chosen = useGalaxyQuality().data?.quality ?? DEFAULT_GALAXY_QUALITY;
  // Automático: nível atual desta sessão (começa no Ultra e desce quando a cena avisa que ficou lenta).
  const [autoStep, setAutoStep] = useState(0);
  const level = chosen === 'auto' ? AUTO_STEPS[autoStep]! : chosen;
  const profile = GALAXY_PROFILES[level];
  const chosenRef = useRef(chosen);
  chosenRef.current = chosen;
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const look = useGalaxyLook().data?.look ?? 'atual';
  const lookRef = useRef(look);
  lookRef.current = look;
  const sunRef = useRef(sun);
  sunRef.current = sun;

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    try {
      scene.current = new GalaxyScene(
        container.current!,
        {
          onSelect: setSelected,
          onOpen: (i) => {
            const note = current.current?.notes[i];
            if (note) openNote(workspaceId, note.path);
          },
          onMoon: (i, name) => {
            const note = current.current?.notes[i];
            if (note) openAttachment(note.path, name);
          },
          onTour: setTour,
        },
        {
          reducedMotion,
          openOnClick: !panel,
          profile: profileRef.current,
          look: lookRef.current,
          onSlow: () => {
            if (chosenRef.current === 'auto') setAutoStep((s) => Math.min(s + 1, AUTO_STEPS.length - 1));
          },
        },
      );
      scene.current.setSun(sunRef.current.name, sunRef.current.color);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
    }
    return () => {
      scene.current?.dispose();
      scene.current = null;
    };
  }, [openNote, workspaceId, panel, openAttachment]);

  useEffect(() => setAttachmentError(null), [selected]);

  useEffect(() => {
    scene.current?.setContemplative(contemplative);
    // Ao entrar, o botão de sair aparece e some sozinho se o mouse não se mexer.
    if (sleepTimer.current) clearTimeout(sleepTimer.current);
    if (contemplative) sleepTimer.current = setTimeout(() => setAwake(false), 2500);
  }, [contemplative]);

  // Esc encerra o tour e o modo contemplativo.
  useEffect(() => {
    if (!tour && !contemplative) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      scene.current?.stopTour();
      setContemplative(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tour, contemplative]);

  useEffect(
    () => () => {
      if (sleepTimer.current) clearTimeout(sleepTimer.current);
    },
    [],
  );

  /** No modo contemplativo, o botão de sair só aparece quando o mouse se mexe. */
  function wakeControls() {
    if (!contemplative) return;
    setAwake(true);
    if (sleepTimer.current) clearTimeout(sleepTimer.current);
    sleepTimer.current = setTimeout(() => setAwake(false), 2500);
  }

  // Trocar de modo nas Configurações vale na hora, sem recriar a cena (a câmera e a seleção ficam onde estão).
  useEffect(() => {
    scene.current?.setProfile(profile);
  }, [profile]);

  // Idem para o estilo (Atual ou Eclipse): só o centro muda; posições e seleção ficam.
  useEffect(() => {
    scene.current?.setLook(look);
  }, [look]);

  // Eventos reais (G5): o Claude editando uma nota manda uma nave até ela; nota alterada no disco pulsa.
  useEffect(() => {
    const offNotes = window.nexus.on(KNOWLEDGE_EVENT_CHANNEL, (payload) => {
      const event = payload as KnowledgeEvent;
      if (event.workspaceId !== workspaceId) return;
      scene.current?.notesChanged(event.paths.filter((p) => /\.md$/i.test(p)));
    });
    const offChat = window.nexus.on(CHAT_EVENT_CHANNEL, (payload) => {
      const event = payload as ChatEvent;
      if (event.type !== 'activity' || !event.activity.changedFile) return;
      const note = noteInVault(knowledgeDir, event.activity.changedFile);
      if (note) scene.current?.claudeEdit(note);
    });
    return () => {
      offNotes();
      offChat();
    };
  }, [workspaceId, knowledgeDir]);

  useEffect(() => {
    scene.current?.setSun(sun.name, sun.color);
  }, [sun.name, sun.color]);

  useEffect(() => {
    if (graph.data && layout && styles) scene.current?.setData(graph.data, layout, styles);
  }, [graph.data, layout, styles]);

  const data = graph.data;
  const homeStats = useMemo(() => (home && data ? computeHomeStats(data, Date.now()) : null), [home, data]);
  const conversations = useQuery({
    queryKey: ['conversations', workspaceId, 'todas'],
    queryFn: () => invoke('conversations:list', { workspaceId }),
    enabled: home,
  });
  const systemColors = useMemo(() => new Map(layout?.systems.map((s) => [s.name, s.color]) ?? []), [layout]);

  /** Leva a câmera até a nota de um caminho (para as ligações do cartão). */
  function focusPath(path: string) {
    const i = data?.notes.findIndex((n) => n.path === path) ?? -1;
    if (i >= 0) scene.current?.focus(i);
  }

  function openConversation(c: Conversation) {
    const chat = useChat.getState();
    chat.setScope(workspaceId, c.projectId);
    chat.select(workspaceId, c.id);
    useLayout.getState().setView('chat');
  }

  // Esc fecha o painel Home (o tour e o modo contemplativo têm o próprio Esc).
  useEffect(() => {
    if (!home) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !tour && !contemplative) setHome(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [home, tour, contemplative]);
  const note = selected === null ? undefined : data?.notes[selected];

  return (
    <div
      className={cn('relative min-h-0 overflow-hidden bg-[#05050b] text-white', panel ? 'flex-1' : 'h-full')}
      data-testid="galaxy-view"
      data-mode={mode}
      onMouseMove={wakeControls}
    >
      <div ref={container} className="absolute inset-0" data-testid="galaxy-canvas" />

      {failure && (
        <Notice
          title="Não foi possível iniciar a visualização 3D"
          description={`O WebGL não está disponível neste computador (${failure}). As notas continuam na aba Nota.`}
        />
      )}
      {graph.isPending && <Notice title="Montando a galáxia…" description="Lendo as notas do vault." />}
      {graph.isError && <Notice title="Não foi possível montar a galáxia" description={graph.error.message} />}
      {data && data.notes.length === 0 && (
        <Notice
          title="Sua galáxia está vazia"
          description="Cada nota vira um planeta, e cada [[link]] uma rota de luz. Crie notas ou peça ao Claude: “registra isso nas notas”."
        />
      )}

      {contemplative && (
        <button
          type="button"
          onClick={() => setContemplative(false)}
          className={cn(
            'absolute top-3 right-3 flex items-center gap-1.5 rounded-xl border border-white/10 bg-black/50 px-3 py-1.5 text-xs text-white/80 backdrop-blur transition-opacity duration-500 hover:text-white',
            awake ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
        >
          <X size={12} /> Sair do modo contemplativo
        </button>
      )}

      {tour && data && layout && (
        <TourCaption
          {...describeStop(tour.stop, data, layout)}
          step={tour.index + 1}
          total={tour.total}
          panel={panel}
          onNext={() => scene.current?.nextStop()}
          onStop={() => scene.current?.stopTour()}
        />
      )}

      {data && data.notes.length > 0 && !contemplative && (
        <>
          <div
            className={cn('absolute flex gap-1.5', panel ? 'top-[3.4rem] right-3' : 'top-10 right-4')}
            role="toolbar"
            aria-label="Explorar a galáxia"
          >
            {!panel && (
              <button
                type="button"
                className={TOOL_BUTTON}
                title="Painel com os números do Workspace e atalhos para a galáxia (Esc fecha)"
                onClick={() => setHome((v) => !v)}
                aria-pressed={home}
                data-testid="galaxy-home-toggle"
              >
                <LayoutDashboard size={14} /> Painel
              </button>
            )}
            <button
              type="button"
              className={TOOL_BUTTON}
              title="Tour guiado pelos sistemas e notas centrais (Esc para sair)"
              onClick={() => (tour ? scene.current?.stopTour() : scene.current?.startTour())}
              aria-pressed={tour !== null}
            >
              <Route size={14} /> {tour ? 'Parar tour' : 'Tour'}
            </button>
            <button
              type="button"
              className={TOOL_BUTTON}
              title="Modo contemplativo: esconde os controles e deixa a galáxia girando (Esc para sair)"
              onClick={() => {
                setAwake(true);
                setContemplative(true);
              }}
            >
              <Sparkles size={14} /> Contemplar
            </button>
          </div>
          <SearchBox
            graph={data}
            workspaceId={workspaceId}
            onPick={(i) => scene.current?.focus(i)}
            onSearch={(m) => scene.current?.setSearch(m)}
            onFrame={(m) => scene.current?.frameNotes(m)}
            panel={panel}
          />
          <p
            className={cn(
              'pointer-events-none absolute text-xs text-white/50',
              panel ? 'top-[3.75rem] left-3' : 'top-4 right-4',
            )}
            data-testid="galaxy-stats"
          >
            {data.notes.length} {data.notes.length === 1 ? 'nota' : 'notas'} · {data.links.length}{' '}
            {data.links.length === 1 ? 'rota' : 'rotas'}
          </p>
          {!panel && !tour && (
            <p className="pointer-events-none absolute right-4 bottom-4 text-[11px] text-white/35">
              Arraste para girar · roda para aproximar · botão direito para mover
            </p>
          )}
        </>
      )}

      {home && homeStats && !panel && !contemplative && (
        <HomePanel
          stats={homeStats}
          systemColors={systemColors}
          conversations={(conversations.data ?? []).slice(0, 6)}
          now={Date.now()}
          onFocusNote={(i) => scene.current?.focus(i)}
          onFrameSystem={(indices) => scene.current?.frameNotes(indices)}
          onOpenConversation={openConversation}
          onClose={() => setHome(false)}
        />
      )}

      {note && selected !== null && !contemplative && (
        <section
          aria-label="Planeta selecionado"
          className={cn(
            'absolute overflow-y-auto rounded-2xl border border-white/10 bg-black/60 p-4 backdrop-blur',
            panel
              ? 'right-3 bottom-3 left-3 max-h-[55%]'
              : home
                ? 'right-4 bottom-4 max-h-[calc(100%-6rem)] w-80'
                : 'bottom-4 left-4 max-h-[calc(100%-6rem)] w-80',
          )}
        >
          <p className="text-sm font-semibold break-words">{note.title}</p>
          <p className="mt-0.5 text-xs text-white/55">
            {note.system || 'Núcleo'} · {note.degree} {note.degree === 1 ? 'conexão' : 'conexões'}
          </p>
          {note.tags.length > 0 && (
            <p className="mt-1 truncate text-xs text-white/55">{note.tags.map((t) => `#${t}`).join(' ')}</p>
          )}
          {note.moons && note.moons.length > 0 && (
            <div className="mt-2" data-testid="planet-moons">
              <p className="text-[11px] tracking-wide text-white/45 uppercase">
                {note.moons.length === 1 ? '1 anexo' : `${note.moons.length} anexos`}
              </p>
              <ul className="mt-1 max-h-28 space-y-0.5 overflow-y-auto" aria-label="Anexos da nota">
                {note.moons.map((name) => (
                  <li key={name} className="group flex items-center gap-1.5 text-xs">
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: MOON_COLORS[moonKind(name)] }}
                    />
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left text-white/80 hover:text-white hover:underline"
                      title={`${MOON_LABELS[moonKind(name)]}: abrir ${name}`}
                      onClick={() => openAttachment(note.path, name)}
                    >
                      {moonName(name)}
                    </button>
                    <button
                      type="button"
                      aria-label={`Mostrar ${moonName(name)} na pasta`}
                      title="Mostrar na pasta"
                      className="shrink-0 text-white/40 opacity-0 group-hover:opacity-100 hover:text-white focus:opacity-100"
                      onClick={() => openAttachment(note.path, name, true)}
                    >
                      <FolderOpen size={12} />
                    </button>
                  </li>
                ))}
              </ul>
              {attachmentError && (
                <p role="alert" className="mt-1 text-xs break-words text-white/70">
                  <Paperclip size={11} className="mr-1 inline" />
                  {attachmentError}
                </p>
              )}
            </div>
          )}
          {styles?.[selected]?.detail && (
            <p className="mt-2 text-xs leading-5 break-words text-white/75" data-testid="planet-detail">
              {styles[selected]!.detail}
            </p>
          )}
          <PlanetRelations key={note.path} workspaceId={workspaceId} path={note.path} onFocusPath={focusPath} />
          <div className="mt-3 flex gap-2">
            <Button variant="primary" className="min-w-0 flex-1" onClick={() => openNote(workspaceId, note.path)}>
              <FileText size={14} /> Abrir nota
            </Button>
            <Button
              aria-label="Editar planeta"
              aria-expanded={editing}
              title="Editar a aparência deste planeta"
              onClick={() => setEditing((e) => !e)}
            >
              <Palette size={14} />
            </Button>
          </div>
          {editing && styles?.[selected] && (
            <PlanetEditor
              key={note.path}
              style={styles[selected]!}
              hasOverride={Boolean(overrides?.[note.path])}
              onChange={(patch: PlanetOverride) =>
                setPlanet.mutate({
                  path: note.path,
                  override: cleanOverride({ ...overrides?.[note.path], ...patch }),
                })
              }
              onReset={() => setPlanet.mutate({ path: note.path, override: null })}
            />
          )}
        </section>
      )}
    </div>
  );
}

/** Quantas ligações cada lista do cartão mostra (o resto vira "+N"). */
const RELATION_ROWS = 6;

/**
 * Prévia e ligações da nota selecionada (GE3): o começo do texto, para onde ela liga e quem a cita. Lê só esta nota,
 * quando ela é escolhida; clicar numa ligação leva a câmera até o planeta dela.
 */
function PlanetRelations({
  workspaceId,
  path,
  onFocusPath,
}: {
  workspaceId: string;
  path: string;
  onFocusPath: (path: string) => void;
}) {
  const note = useNote(workspaceId, path);
  const links = useNoteLinks(workspaceId, path);
  const preview = useMemo(() => (note.data ? notePreview(note.data.content) : ''), [note.data]);
  // Mesmo destino citado várias vezes aparece uma vez só.
  const outgoing = useMemo(() => {
    const seen = new Set<string>();
    return (links.data?.outgoing ?? []).filter((l) => {
      const key = l.path ?? `?${l.target.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [links.data]);
  const backlinks = links.data?.backlinks ?? [];

  return (
    <div data-testid="planet-relations">
      {preview && (
        <p className="mt-2 line-clamp-5 text-xs leading-5 break-words text-white/65" data-testid="planet-preview">
          {preview}
        </p>
      )}
      {outgoing.length > 0 && (
        <RelationList label="Liga a" count={outgoing.length} testId="planet-outgoing">
          {outgoing.slice(0, RELATION_ROWS).map((l) => (
            <li key={l.path ?? `?${l.target}`}>
              {l.path ? (
                <RelationButton onClick={() => onFocusPath(l.path!)}>{l.target}</RelationButton>
              ) : (
                <span className="block truncate px-1 text-xs text-white/40" title="Esta nota ainda não existe">
                  {l.target}
                </span>
              )}
            </li>
          ))}
        </RelationList>
      )}
      {backlinks.length > 0 && (
        <RelationList label="Citada por" count={backlinks.length} testId="planet-backlinks">
          {backlinks.slice(0, RELATION_ROWS).map((b) => (
            <li key={b.path}>
              <RelationButton onClick={() => onFocusPath(b.path)}>{b.title}</RelationButton>
            </li>
          ))}
        </RelationList>
      )}
    </div>
  );
}

function RelationList({
  label,
  count,
  testId,
  children,
}: {
  label: string;
  count: number;
  testId: string;
  children: ReactNode;
}) {
  return (
    <div className="mt-2" data-testid={testId}>
      <p className="text-[11px] tracking-wide text-white/45 uppercase">
        {label} ({count})
      </p>
      <ul className="mt-0.5 space-y-0.5">{children}</ul>
      {count > RELATION_ROWS && <p className="px-1 pt-0.5 text-[11px] text-white/40">+ {count - RELATION_ROWS}</p>}
    </div>
  );
}

function RelationButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full truncate rounded-md px-1 py-0.5 text-left text-xs text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white/60"
    >
      {children}
    </button>
  );
}

const TOOL_BUTTON =
  'flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/60 px-2.5 py-1.5 text-xs text-white/85 backdrop-blur hover:bg-black/75 hover:text-white focus-visible:outline-2 focus-visible:outline-white/60';

/** Legenda da parada atual do tour, com os controles. */
function TourCaption({
  title,
  detail,
  step,
  total,
  panel,
  onNext,
  onStop,
}: {
  title: string;
  detail: string;
  step: number;
  total: number;
  panel: boolean;
  onNext: () => void;
  onStop: () => void;
}) {
  return (
    <section
      aria-label="Tour guiado"
      aria-live="polite"
      className={cn(
        'absolute rounded-2xl border border-white/10 bg-black/60 px-4 py-3 backdrop-blur',
        panel ? 'right-3 bottom-3 left-3' : 'bottom-10 left-1/2 w-80 -translate-x-1/2',
      )}
    >
      <p className="text-[11px] tracking-wide text-white/45 uppercase" data-testid="tour-step">
        Parada {step} de {total}
      </p>
      <p className="mt-0.5 truncate text-sm font-semibold">{title}</p>
      <p className="truncate text-xs text-white/60">{detail}</p>
      <div className="mt-2 flex justify-end gap-2">
        <Button onClick={onStop}>
          <X size={14} /> Parar
        </Button>
        <Button variant="primary" onClick={onNext}>
          <SkipForward size={14} /> {step === total ? 'Concluir' : 'Próxima'}
        </Button>
      </div>
    </section>
  );
}

/** Aviso sobre o fundo da galáxia, que é sempre escuro (nos dois temas). */
function Notice({ title, description }: { title: string; description: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-3 grid size-10 place-items-center rounded-xl bg-white/10 text-white/70">
          <Orbit size={18} />
        </div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs leading-5 text-white/55">{description}</p>
      </div>
    </div>
  );
}

/**
 * Busca única da galáxia (G8 + GE2): enquanto digita, as notas encontradas acendem na galáxia e o resto apaga; a lista
 * mostra as primeiras notas (por título e caminho; aceita `#tag`) e, logo abaixo, os trechos de conversas que citam o
 * texto (o que você escreveu e o que o Claude respondeu). Só dados locais: nada vai ao Claude. "Enquadrar" leva a
 * câmera a mostrar todas as notas.
 */
function SearchBox({
  graph,
  workspaceId,
  onPick,
  onSearch,
  onFrame,
  panel,
}: {
  graph: GalaxyGraph;
  workspaceId: string;
  onPick: (index: number) => void;
  onSearch: (matches: number[] | null) => void;
  onFrame: (matches: number[]) => void;
  panel: boolean;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const results = useMemo(() => searchNotes(graph, query), [graph, query]);
  const matches = useMemo(() => matchNotes(graph, query), [graph, query]);
  const open = query.trim().length > 0;
  // `#tag` é coisa de nota: com ela, as conversas não entram na busca.
  const chats = useConversationSearch(workspaceId, query.trim().startsWith('#') ? '' : query);
  const chatHits = useMemo(() => chats.hits.slice(0, CHAT_ROWS), [chats.hits]);
  const total = results.length + chatHits.length;
  const searchRef = useRef(onSearch);
  searchRef.current = onSearch;
  useEffect(() => {
    searchRef.current(open ? matches : null);
  }, [open, matches]);
  useEffect(() => () => searchRef.current(null), []);

  function pick(i: number) {
    onPick(i);
    setQuery('');
  }

  function pickChat(hit: SearchHit) {
    openSearchHit(workspaceId, hit);
    setQuery('');
  }

  /** Abre o resultado marcado (nota ou trecho de conversa). Devolve se havia algum. */
  function pickActive(): boolean {
    if (active < results.length) {
      pick(results[active]!);
      return true;
    }
    const hit = chatHits[active - results.length];
    if (!hit) return false;
    pickChat(hit);
    return true;
  }

  return (
    <div className={cn('absolute', panel ? 'top-3 right-3 left-3' : 'top-4 left-4 w-72')}>
      <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/60 px-3 py-2 backdrop-blur focus-within:border-white/30">
        <Search size={14} className="shrink-0 text-white/50" />
        <input
          type="search"
          role="combobox"
          aria-label="Buscar nota na galáxia"
          aria-expanded={open}
          aria-controls="galaxy-results"
          placeholder="Buscar notas e conversas…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, total - 1));
            else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
            else if (e.key === 'Enter') {
              if (!pickActive()) return;
            } else if (e.key === 'Escape') setQuery('');
            else return;
            e.preventDefault();
          }}
          className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-white/40 focus:outline-none"
        />
      </label>
      {open && (
        <ul
          id="galaxy-results"
          role="listbox"
          aria-label="Resultados da busca"
          className="mt-1 max-h-[22rem] overflow-y-auto rounded-xl border border-white/10 bg-black/75 py-1 backdrop-blur"
        >
          <li role="presentation" className="px-3 pt-1 pb-0.5 text-[10px] tracking-wide text-white/40 uppercase">
            Notas
          </li>
          {results.length === 0 && <li className="px-3 py-1.5 text-xs text-white/50">Nenhuma nota encontrada.</li>}
          {results.map((i, k) => (
            <li
              key={graph.notes[i]!.path}
              role="option"
              aria-selected={k === active}
              data-testid="search-note"
              onMouseEnter={() => setActive(k)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(i);
              }}
              className={cn('cursor-pointer px-3 py-1.5', k === active && 'bg-white/10')}
            >
              <p className="truncate text-sm">{graph.notes[i]!.title}</p>
              <p className="truncate text-[11px] text-white/45">{graph.notes[i]!.path}</p>
            </li>
          ))}
          {(chatHits.length > 0 || chats.pending) && (
            <li role="presentation" className="px-3 pt-2 pb-0.5 text-[10px] tracking-wide text-white/40 uppercase">
              Conversas
            </li>
          )}
          {chatHits.length === 0 && chats.pending && (
            <li className="px-3 py-1.5 text-xs text-white/45">Procurando nas conversas…</li>
          )}
          {chatHits.map((hit, k) => {
            const index = results.length + k;
            return (
              <li
                key={`${hit.conversationId}:${hit.messageId ?? 'titulo'}`}
                role="option"
                aria-selected={index === active}
                data-testid="search-chat"
                onMouseEnter={() => setActive(index)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickChat(hit);
                }}
                className={cn('cursor-pointer px-3 py-1.5', index === active && 'bg-white/10')}
              >
                <p className="truncate text-[11px] text-white/45">
                  {hit.role === 'user' ? 'Você' : hit.role === 'assistant' ? 'Claude' : 'Título'} ·{' '}
                  {hit.conversationTitle}
                </p>
                <p className="line-clamp-2 text-xs leading-4 text-white/85">
                  <Highlighted text={hit.text} ranges={hit.ranges} />
                </p>
              </li>
            );
          })}
          {chats.error && (
            <li role="alert" className="px-3 py-1.5 text-xs text-white/60">
              Não foi possível buscar nas conversas.
            </li>
          )}
        </ul>
      )}
      {open && matches.length > 0 && (
        <div className="mt-1 flex items-center gap-2 rounded-xl border border-white/10 bg-black/60 px-3 py-1.5 text-xs text-white/60 backdrop-blur">
          <span className="min-w-0 flex-1" data-testid="search-count">
            {matches.length === 1 ? '1 nota acesa na galáxia' : `${matches.length} notas acesas na galáxia`}
          </span>
          <button
            type="button"
            className="flex shrink-0 items-center gap-1 text-white/80 hover:text-white"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onFrame(matches)}
          >
            <Focus size={12} /> Enquadrar
          </button>
        </div>
      )}
    </div>
  );
}

/** Quantos trechos de conversas a lista da galáxia mostra (a busca completa tem a janela própria, Ctrl+Shift+F). */
const CHAT_ROWS = 5;

/** Tira as chaves desfeitas (`undefined`) e as anotações vazias, para o que vai ser gravado ser só o que foi trocado. */
function cleanOverride(override: PlanetOverride): PlanetOverride {
  const out = Object.fromEntries(Object.entries(override).filter(([, v]) => v !== undefined && v !== ''));
  return out as PlanetOverride;
}
