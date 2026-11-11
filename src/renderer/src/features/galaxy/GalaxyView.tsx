import { FileText, FolderOpen, Focus, Orbit, Palette, Paperclip, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PALETTE } from '@shared/brand';
import { CHAT_EVENT_CHANNEL, type ChatEvent } from '@shared/chat';
import { KNOWLEDGE_EVENT_CHANNEL, type GalaxyGraph, type KnowledgeEvent } from '@shared/knowledge';
import { resolvePlanetStyle, type PlanetOverride } from '@shared/planets';
import { Button } from '@renderer/components/ui/Button';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { useLayout } from '@renderer/app/shell/layout-store';
import { useGalaxyGraph, useGalaxyStyles, useSetPlanetStyle } from '@renderer/features/knowledge/queries';
import { useActiveWorkspace } from '@renderer/features/workspaces/queries';
import { cn } from '@renderer/lib/cn';
import { invoke } from '@renderer/lib/ipc';
import { GalaxyScene } from './galaxy-scene';
import { layoutGalaxy, matchNotes, noteInVault, searchNotes } from './layout';
import { DEFAULT_GALAXY_QUALITY, GALAXY_PROFILES } from './quality';
import { useGalaxyQuality } from '@renderer/features/settings/queries';
import { PlanetEditor } from './PlanetEditor';
import { MOON_COLORS, MOON_LABELS, moonKind, moonName } from './moon-effects';

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
  return <Galaxy key={workspace.id} workspaceId={workspace.id} knowledgeDir={workspace.knowledgeDir} mode={mode} />;
}

function Galaxy({ workspaceId, knowledgeDir, mode }: { workspaceId: string; knowledgeDir: string; mode: GalaxyMode }) {
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
  const profile = GALAXY_PROFILES[useGalaxyQuality().data?.quality ?? DEFAULT_GALAXY_QUALITY];
  const profileRef = useRef(profile);
  profileRef.current = profile;

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
        },
        { reducedMotion, openOnClick: !panel, profile: profileRef.current },
      );
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
    }
    return () => {
      scene.current?.dispose();
      scene.current = null;
    };
  }, [openNote, workspaceId, panel, openAttachment]);

  useEffect(() => setAttachmentError(null), [selected]);

  // Trocar de modo nas Configurações vale na hora, sem recriar a cena (a câmera e a seleção ficam onde estão).
  useEffect(() => {
    scene.current?.setProfile(profile);
  }, [profile]);

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
    if (graph.data && layout && styles) scene.current?.setData(graph.data, layout, styles);
  }, [graph.data, layout, styles]);

  const data = graph.data;
  const note = selected === null ? undefined : data?.notes[selected];

  return (
    <div
      className={cn('relative min-h-0 overflow-hidden bg-[#05050b] text-white', panel ? 'flex-1' : 'h-full')}
      data-testid="galaxy-view"
      data-mode={mode}
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

      {data && data.notes.length > 0 && (
        <>
          <SearchBox
            graph={data}
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
          {!panel && (
            <p className="pointer-events-none absolute right-4 bottom-4 text-[11px] text-white/35">
              Arraste para girar · roda para aproximar · botão direito para mover
            </p>
          )}
        </>
      )}

      {note && selected !== null && (
        <section
          aria-label="Planeta selecionado"
          className={cn(
            'absolute rounded-2xl border border-white/10 bg-black/60 p-4 backdrop-blur',
            panel ? 'right-3 bottom-3 left-3' : 'bottom-4 left-4 w-72',
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
 * Busca da galáxia (G8): enquanto digita, as notas encontradas acendem na galáxia e o resto apaga. Aceita `#tag`. A
 * lista mostra as primeiras; "Enquadrar" leva a câmera a mostrar todas.
 */
function SearchBox({
  graph,
  onPick,
  onSearch,
  onFrame,
  panel,
}: {
  graph: GalaxyGraph;
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
          placeholder="Buscar nota ou #tag…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, results.length - 1));
            else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
            else if (e.key === 'Enter' && results[active] !== undefined) pick(results[active]);
            else if (e.key === 'Escape') setQuery('');
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
          aria-label="Notas encontradas"
          className="mt-1 overflow-hidden rounded-xl border border-white/10 bg-black/75 py-1 backdrop-blur"
        >
          {results.length === 0 && <li className="px-3 py-2 text-xs text-white/50">Nenhuma nota encontrada.</li>}
          {results.map((i, k) => (
            <li
              key={graph.notes[i]!.path}
              role="option"
              aria-selected={k === active}
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

/** Tira as chaves desfeitas (`undefined`) e as anotações vazias, para o que vai ser gravado ser só o que foi trocado. */
function cleanOverride(override: PlanetOverride): PlanetOverride {
  const out = Object.fromEntries(Object.entries(override).filter(([, v]) => v !== undefined && v !== ''));
  return out as PlanetOverride;
}
