import type { Workspace } from '@shared/workspace';
import { useClaudeStatus } from '@renderer/features/claude/queries';
import { ModelPicker } from '@renderer/features/models/ModelPicker';
import { useSetWorkspaceDefaultModel } from '@renderer/features/models/queries';

/** Modelo e esforço usados pelas conversas deste Workspace que não escolheram outro. */
export function ModelDefaultSection({ ws }: { ws: Workspace }) {
  const claude = useClaudeStatus();
  const setDefault = useSetWorkspaceDefaultModel();

  return (
    <section className="mt-6 rounded-2xl border border-border bg-surface p-5" data-testid="model-default-section">
      <h2 className="text-sm font-semibold">Modelo padrão</h2>
      <p className="mt-1 mb-3 text-xs text-muted">
        Usado nas conversas deste Workspace que não escolheram outro modelo. Ex.: Haiku para perguntas rápidas, Opus
        para tarefas pesadas.
      </p>
      <ModelPicker
        placement="down"
        value={{ model: ws.defaultModel, effort: ws.defaultEffort }}
        disabled={!claude.data?.ready}
        inheritedLabel={(catalog) =>
          `Padrão do Claude Code${catalog?.defaultModel ? ` (${catalog.defaultModel.displayName})` : ''}`
        }
        onChange={(choice) => setDefault.mutate({ id: ws.id, ...choice })}
      />
      {setDefault.isError && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {setDefault.error.message}
        </p>
      )}
    </section>
  );
}
