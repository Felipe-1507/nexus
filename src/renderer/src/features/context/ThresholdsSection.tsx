import { useEffect, useState } from 'react';
import { contextThresholdsSchema, DEFAULT_CONTEXT_THRESHOLDS, type ContextThresholds } from '@shared/context';
import { Button } from '@renderer/components/ui/Button';
import { useContextThresholds, useSetContextThresholds } from './queries';

const FIELDS: Array<{ key: keyof ContextThresholds; label: string }> = [
  { key: 'attention', label: 'Atenção' },
  { key: 'high', label: 'Contexto elevado' },
  { key: 'critical', label: 'Quase cheio' },
];

/** A partir de quantos % da janela do modelo o indicador de cada conversa muda de faixa. */
export function ThresholdsSection() {
  const current = useContextThresholds();
  const save = useSetContextThresholds();
  const [draft, setDraft] = useState<Record<keyof ContextThresholds, string>>({
    attention: '',
    high: '',
    critical: '',
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (current.data) {
      setDraft({
        attention: String(current.data.attention),
        high: String(current.data.high),
        critical: String(current.data.critical),
      });
    }
  }, [current.data]);

  async function submit(values: Record<keyof ContextThresholds, string>): Promise<void> {
    setError(null);
    const parsed = contextThresholdsSchema.safeParse({
      attention: Number(values.attention),
      high: Number(values.high),
      critical: Number(values.critical),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Valores inválidos.');
      return;
    }
    try {
      await save.mutateAsync(parsed.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-5" data-testid="context-thresholds">
      <h2 className="text-sm font-semibold">Contexto das conversas</h2>
      <p className="mt-1 text-xs text-muted">
        Quando o contexto de uma conversa passa destes percentuais da janela do modelo, o indicador no topo dela muda de
        faixa e o Nexus sugere continuar numa conversa nova. Nada é feito automaticamente.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-4">
        {FIELDS.map((f) => (
          <label key={f.key} className="text-xs">
            <span className="text-muted">{f.label} (%)</span>
            <input
              type="number"
              min={1}
              max={100}
              value={draft[f.key]}
              onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              data-testid={`threshold-${f.key}`}
              className="mt-1 block w-24 rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-accent"
            />
          </label>
        ))}
        <Button
          disabled={save.isPending || !current.data}
          onClick={() => void submit(draft)}
          data-testid="threshold-save"
        >
          Salvar
        </Button>
        <Button
          variant="ghost"
          disabled={save.isPending}
          onClick={() => {
            const d = DEFAULT_CONTEXT_THRESHOLDS;
            const values = { attention: String(d.attention), high: String(d.high), critical: String(d.critical) };
            setDraft(values);
            void submit(values);
          }}
        >
          Restaurar padrão
        </Button>
      </div>
      {save.isSuccess && !error && (
        <p role="status" className="mt-2 text-xs text-ok">
          Limites salvos.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger" data-testid="threshold-error">
          {error}
        </p>
      )}
    </section>
  );
}
