import { Plus } from 'lucide-react';
import { BRAND } from '@shared/brand';
import { Button } from '@renderer/components/ui/Button';
import { useLayout } from '@renderer/app/shell/layout-store';
import { ConnectClaude } from '@renderer/features/claude/ConnectClaude';
import { useClaudeStatus } from '@renderer/features/claude/queries';
import { useActiveWorkspace, useWorkspaces } from '@renderer/features/workspaces/queries';
import { useChat } from './chat-store';
import { Composer } from './Composer';
import { ConversationView } from './ConversationView';

/** Área central: a conversa do Workspace ativo, ou o convite para criar o primeiro Workspace. */
export function ChatView() {
  const { data } = useWorkspaces();
  const active = useActiveWorkspace();
  const claude = useClaudeStatus();
  const selected = useChat((s) => (active ? (s.selected[active.id] ?? null) : null));

  if (active) {
    return (
      <ConversationView
        key={`${active.id}:${selected ?? 'nova'}`}
        workspace={active}
        conversationId={selected}
        claudeReady={Boolean(claude.data?.ready)}
      />
    );
  }
  return <NoWorkspace hasWorkspaces={(data?.workspaces.length ?? 0) > 0} loaded={Boolean(data)} />;
}

function NoWorkspace({ hasWorkspaces, loaded }: { hasWorkspaces: boolean; loaded: boolean }) {
  const openCreate = useLayout((s) => s.openCreateWorkspace);
  return (
    <div className="flex h-full flex-col" data-testid="chat-view">
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-md text-center">
          {BRAND.logo ? (
            <img src={BRAND.logo} alt="" className="mx-auto mb-5 h-14 w-auto" />
          ) : (
            <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-accent-soft ring-1 ring-accent/25">
              <span className="size-3.5 rounded-full bg-accent shadow-[0_0_28px_var(--accent)]" />
            </div>
          )}
          <h1 className="text-xl font-semibold tracking-tight">Seu núcleo está pronto</h1>
          <p className="mt-2 text-sm leading-6 text-muted">
            Crie um Workspace para começar a conversar com o Claude sobre seus projetos e conhecimentos.
          </p>
          {loaded && !hasWorkspaces && (
            <Button variant="primary" className="mt-5" onClick={openCreate}>
              <Plus size={15} /> Criar Workspace
            </Button>
          )}
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl px-6 pb-6">
        <ConnectClaude className="mb-3" />
        <Composer
          placeholder="Escreva sua mensagem…"
          disabled
          disabledReason="Crie um Workspace para conversar"
          running={false}
          onSend={async () => false}
          onStop={() => {}}
        />
      </div>
    </div>
  );
}
