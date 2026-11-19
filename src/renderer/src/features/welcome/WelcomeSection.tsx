import { useEffect, useState } from 'react';
import { Button } from '@renderer/components/ui/Button';
import { useActiveWorkspace } from '@renderer/features/workspaces/queries';
import { fetchDue, openWelcome, useSetWelcomeSettings, useWelcomeSettings } from './queries';

/** Configurações → Boas-vindas: liga/desliga a tela, escolhe se o Claude escreve o resumo e o nome da saudação. */
export function WelcomeSection() {
  const settings = useWelcomeSettings();
  const save = useSetWelcomeSettings();
  const workspace = useActiveWorkspace();
  const saved = settings.data?.name ?? '';
  const [name, setName] = useState(saved);
  useEffect(() => setName(saved), [saved]);
  const data = settings.data;

  const preview = async () => {
    if (!workspace) return;
    const due = await fetchDue(true);
    // Ao fechar, volta para as Configurações.
    openWelcome(due, workspace.id);
  };

  return (
    <section className="rounded-2xl border border-border bg-surface p-5" data-testid="welcome-settings">
      <h2 className="text-sm font-semibold">Boas-vindas</h2>
      <p className="mt-1 text-xs text-muted">
        Na primeira abertura do dia, o Nexus mostra uma saudação e o que mudou nos seus sistemas e projetos.
      </p>
      {data && (
        <div className="mt-4 space-y-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={data.enabled}
              onChange={(e) => save.mutate({ enabled: e.target.checked })}
              className="accent-accent"
              data-testid="welcome-enabled"
            />
            Mostrar na primeira abertura do dia
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={data.ai}
              onChange={(e) => save.mutate({ ai: e.target.checked })}
              className="mt-1 accent-accent"
              data-testid="welcome-ai"
            />
            <span>
              Deixar o Claude escrever o resumo
              <span className="block text-xs text-muted">
                Usa o modelo pequeno (Haiku), com poucos tokens por dia, e envia à Anthropic só os títulos de commits,
                notas e conversas do período. Desligado, o resumo é montado aqui, sem IA.
              </span>
            </span>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-muted">Nome na saudação</span>
            <input
              value={name}
              maxLength={40}
              placeholder="Primeiro nome do git"
              onChange={(e) => setName(e.target.value)}
              onBlur={() => name.trim() !== saved && save.mutate({ name: name.trim() || null })}
              className="w-48 rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent"
              data-testid="welcome-name"
            />
          </label>
          <Button onClick={() => void preview()} disabled={!workspace} data-testid="welcome-preview">
            Ver agora
          </Button>
        </div>
      )}
    </section>
  );
}
