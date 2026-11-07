import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  Download,
  FolderOpen,
  MessageSquare,
  Network,
  ShieldCheck,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { Project } from '@shared/project';
import { Button } from '@renderer/components/ui/Button';
import { IconButton } from '@renderer/components/ui/IconButton';
import { useLayout } from '@renderer/app/shell/layout-store';
import { useChat } from '@renderer/features/chat/chat-store';
import { useOpenScope } from '@renderer/features/chat/queries';
import { useActiveWorkspace } from '@renderer/features/workspaces/queries';
import { isNetworkPath, projectIssue } from './ProjectList';
import {
  useArchiveProject,
  useClaudeSessions,
  useImportSession,
  useProjects,
  useProjectTrust,
  useSetProjectInstructions,
} from './queries';

/** Página do projeto selecionado: pasta, confiança, instruções e conversas do Claude Code para importar. */
export function ProjectView() {
  const workspace = useActiveWorkspace();
  const projectId = useChat((s) => (workspace ? s.scope[workspace.id] : null));
  const projects = useProjects(workspace?.id);
  const setView = useLayout((s) => s.setView);
  const project = projects.data?.find((p) => p.id === projectId);

  if (!workspace || !project) {
    return (
      <div className="grid h-full place-items-center">
        <Button onClick={() => setView('chat')}>Voltar</Button>
      </div>
    );
  }
  return <ProjectDetails key={project.id} project={project} />;
}

function ProjectDetails({ project }: { project: Project }) {
  const setView = useLayout((s) => s.setView);
  const issue = projectIssue(project);

  return (
    <div className="h-full overflow-y-auto" data-testid="project-view">
      <div className="mx-auto max-w-3xl px-8 py-8">
        <div className="mb-6 flex items-center gap-3">
          <IconButton label="Voltar ao chat" onClick={() => setView('chat')}>
            <ArrowLeft size={16} />
          </IconButton>
          <div className="grid size-10 place-items-center rounded-xl bg-surface-2 text-accent">
            {isNetworkPath(project.path) ? <Network size={18} /> : <FolderOpen size={18} />}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold tracking-tight">{project.name}</h1>
            <p className="truncate font-mono text-xs text-muted" title={project.path}>
              {project.path}
            </p>
          </div>
          <span className="rounded-md bg-surface-2 px-2 py-1 text-[11px] text-muted">
            {project.kind === 'linked' ? 'Pasta vinculada' : 'Pasta do Workspace'}
          </span>
          <Button onClick={() => setView('chat')}>
            <MessageSquare size={14} /> Conversar
          </Button>
        </div>

        {issue && (
          <div
            role="alert"
            className="mb-6 flex gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
          >
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-500" />
            {issue}
          </div>
        )}

        <Instructions project={project} />
        {project.configRisks.length > 0 && <Trust project={project} />}
        {project.status === 'ok' && <ImportSessions project={project} />}
        <ArchiveProject project={project} />
      </div>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="mt-6 rounded-2xl border border-border bg-surface p-5 first:mt-0">
      <h2 className="text-sm font-semibold">{title}</h2>
      {description && <p className="mt-1 mb-3 text-xs leading-5 text-muted">{description}</p>}
      {children}
    </section>
  );
}

function Instructions({ project }: { project: Project }) {
  const [text, setText] = useState(project.instructions);
  const save = useSetProjectInstructions();
  const dirty = text !== project.instructions;
  return (
    <Section
      title="Instruções do projeto"
      description="Somam-se às instruções gerais e às do Workspace nas conversas deste projeto. O CLAUDE.md da pasta continua valendo."
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Instruções do projeto"
        placeholder="Ex.: API em Node + Prisma. Nunca rode migrações no banco de produção."
        className="min-h-32 w-full resize-y rounded-xl border border-border bg-bg p-3 font-mono text-[13px] leading-6 outline-none focus:border-accent"
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-muted" data-testid="project-instructions-status">
          {save.isPending ? 'Salvando…' : dirty ? 'Alterações não salvas' : 'Salvo'}
        </span>
        <Button
          variant="primary"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate({ id: project.id, instructions: text })}
        >
          Salvar
        </Button>
      </div>
      {save.isError && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {save.error.message}
        </p>
      )}
    </Section>
  );
}

function Trust({ project }: { project: Project }) {
  const trust = useProjectTrust();
  const trusted = project.configTrust === 'trusted';
  return (
    <Section
      title="Configurações do próprio projeto"
      description={
        trusted
          ? 'Você confiou nestas configurações: elas são carregadas nas conversas deste projeto.'
          : project.configTrust === 'changed'
            ? 'Estas configurações mudaram desde que você confiou nelas e não estão sendo carregadas.'
            : 'Não estão sendo carregadas (nem o CLAUDE.md da pasta) até você confiar nelas.'
      }
    >
      <ul className="mb-3 list-disc space-y-0.5 pl-5 text-xs" data-testid="project-risks">
        {project.configRisks.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <Button onClick={() => trust.mutate({ id: project.id, trust: !trusted })} disabled={trust.isPending}>
        <ShieldCheck size={14} /> {trusted ? 'Deixar de confiar' : 'Confiar nestas configurações'}
      </Button>
    </Section>
  );
}

function ImportSessions({ project }: { project: Project }) {
  const [enabled, setEnabled] = useState(false);
  const sessions = useClaudeSessions(project.id, enabled);
  const importSession = useImportSession(project.workspaceId);
  const select = useChat((s) => s.select);
  const setView = useLayout((s) => s.setView);

  async function run(sessionId: string) {
    try {
      const conversation = await importSession.mutateAsync({ projectId: project.id, sessionId });
      select(project.workspaceId, conversation.id);
      setView('chat');
    } catch {
      // erro exibido abaixo
    }
  }

  return (
    <Section
      title="Conversas do Claude Code nesta pasta"
      description="Conversas feitas no terminal ou no VS Code. Ao importar, as últimas mensagens aparecem aqui e o Claude continua com todo o contexto."
    >
      {!enabled ? (
        <Button onClick={() => setEnabled(true)}>Procurar conversas</Button>
      ) : (
        <>
          {sessions.isPending && <p className="text-xs text-muted">Procurando…</p>}
          {sessions.isError && (
            <p role="alert" className="text-xs text-danger">
              {sessions.error.message}
            </p>
          )}
          {sessions.data?.length === 0 && (
            <p className="text-xs text-muted">Nenhuma conversa encontrada nesta pasta.</p>
          )}
          <ul className="space-y-1" aria-label="Conversas do Claude Code">
            {sessions.data?.map((s) => (
              <li key={s.sessionId} className="flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2 text-xs">
                <div className="min-w-0 flex-1">
                  <p className="truncate">{s.summary || 'Conversa sem título'}</p>
                  <p className="text-[11px] text-muted">
                    {new Date(s.lastModified).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                  </p>
                </div>
                {s.imported ? (
                  <span className="text-[11px] text-muted">Importada</span>
                ) : (
                  <Button
                    className="px-2.5 py-1 text-xs"
                    disabled={importSession.isPending}
                    onClick={() => void run(s.sessionId)}
                  >
                    <Download size={13} />{' '}
                    {importSession.isPending && importSession.variables?.sessionId === s.sessionId
                      ? 'Importando…'
                      : 'Importar'}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {importSession.isError && (
            <p role="alert" className="mt-2 text-xs text-danger">
              {importSession.error.message}
            </p>
          )}
        </>
      )}
    </Section>
  );
}

function ArchiveProject({ project }: { project: Project }) {
  const archive = useArchiveProject();
  const openScope = useOpenScope();
  const setView = useLayout((s) => s.setView);
  return (
    <section className="mt-6 flex items-center justify-between gap-4 rounded-2xl border border-border p-5">
      <div>
        <h2 className="text-sm font-semibold">Remover do Workspace</h2>
        <p className="mt-1 text-xs text-muted">O projeto sai da lista. A pasta e os arquivos não são tocados.</p>
      </div>
      <Button
        disabled={archive.isPending}
        onClick={async () => {
          try {
            await archive.mutateAsync(project.id);
            await openScope(project.workspaceId, null);
            setView('chat');
          } catch {
            // erro exibido abaixo
          }
        }}
      >
        <Archive size={14} /> Remover
      </Button>
      {archive.isError && (
        <p role="alert" className="text-xs text-danger">
          {archive.error.message}
        </p>
      )}
    </section>
  );
}
