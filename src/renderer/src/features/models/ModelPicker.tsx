import { Check, ChevronDown, ChevronRight, Cpu } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { EFFORT_LABELS, type Effort, type ModelCatalog, type ModelChoice, type ModelOption } from '@shared/models';
import { cn } from '@renderer/lib/cn';
import { useModelCatalog } from './queries';

interface ModelPickerProps {
  value: ModelChoice;
  onChange: (choice: ModelChoice) => void;
  /** O que "Padrão" significa aqui (ex.: "Sonnet 5.5 · padrão do Workspace"). */
  inheritedLabel: (catalog: ModelCatalog | undefined) => string;
  disabled?: boolean;
  /** `up` no campo de mensagem (abre para cima); `down` em páginas. */
  placement?: 'up' | 'down';
}

export function modelName(catalog: ModelCatalog | undefined, value: string): string {
  return catalog?.models.find((m) => m.value === value)?.displayName ?? value;
}

/** Seletor de modelo e esforço. `null` em qualquer campo significa "herdar". */
export function ModelPicker({ value, onChange, inheritedLabel, disabled, placement = 'up' }: ModelPickerProps) {
  const catalog = useModelCatalog();
  const [open, setOpen] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const data = catalog.data;
  const selected: ModelOption | null | undefined = value.model
    ? data?.models.find((m) => m.value === value.model)
    : data?.defaultModel;
  const efforts = selected?.efforts ?? [];
  const label = value.model ? modelName(data, value.model) : inheritedLabel(data);
  const aliases = data?.models.filter((m) => m.kind === 'alias') ?? [];
  const versions = data?.models.filter((m) => m.kind === 'version') ?? [];

  const pick = (model: string | null) => {
    const options = model ? data?.models.find((m) => m.value === model)?.efforts : data?.defaultModel?.efforts;
    // Esforço que o modelo novo não aceita volta para "padrão".
    const effort = value.effort && options?.includes(value.effort) ? value.effort : null;
    onChange({ model, effort });
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Modelo: ${label}${value.effort ? `, esforço ${EFFORT_LABELS[value.effort]}` : ''}`}
        data-testid="model-picker"
        className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50"
      >
        <Cpu size={13} />
        <span className="max-w-48 truncate">{label}</span>
        {value.effort && <span className="text-muted">· {EFFORT_LABELS[value.effort]}</span>}
        <ChevronDown size={12} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Escolher modelo"
          className={cn(
            'absolute left-0 z-30 w-[22rem] rounded-xl border border-border bg-surface p-1.5 shadow-2xl',
            placement === 'up' ? 'bottom-full mb-2' : 'top-full mt-2',
          )}
        >
          {catalog.isPending && <p className="px-3 py-2 text-xs text-muted">Consultando o Claude Code…</p>}
          {catalog.isError && (
            <p role="alert" className="px-3 py-2 text-xs text-danger">
              {catalog.error.message}
            </p>
          )}
          {data && (
            <div role="listbox" aria-label="Modelos" className="max-h-80 overflow-y-auto">
              <Option
                label={inheritedLabel(data)}
                description="Segue o padrão"
                selected={value.model === null}
                onSelect={() => pick(null)}
              />
              {aliases.map((m) => (
                <Option
                  key={m.value}
                  label={m.displayName}
                  description={m.description}
                  selected={value.model === m.value}
                  onSelect={() => pick(m.value)}
                />
              ))}
              {versions.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowVersions((v) => !v)}
                    className="flex w-full items-center gap-1 px-2.5 py-1.5 text-left text-[11px] text-muted hover:text-text"
                  >
                    <ChevronRight size={12} className={cn('transition-transform', showVersions && 'rotate-90')} />
                    Outras versões ({versions.length})
                  </button>
                  {showVersions &&
                    versions.map((m) => (
                      <Option
                        key={m.value}
                        label={m.displayName}
                        selected={value.model === m.value}
                        onSelect={() => pick(m.value)}
                      />
                    ))}
                </>
              )}
            </div>
          )}

          {efforts.length > 0 && (
            <div className="mt-1 border-t border-border px-1.5 pt-2 pb-1">
              <p className="mb-1.5 text-[11px] text-muted">Esforço</p>
              <div role="radiogroup" aria-label="Esforço" className="flex flex-wrap gap-1">
                {[null, ...efforts].map((e: Effort | null) => (
                  <button
                    key={e ?? 'padrao'}
                    type="button"
                    role="radio"
                    aria-checked={value.effort === e}
                    onClick={() => onChange({ model: value.model, effort: e })}
                    className={cn(
                      'rounded-md px-2 py-1 text-[11px] transition-colors',
                      value.effort === e ? 'bg-accent-soft text-text' : 'text-muted hover:bg-surface-2 hover:text-text',
                    )}
                  >
                    {e ? EFFORT_LABELS[e] : 'Padrão'}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Option({
  label,
  description,
  selected,
  onSelect,
}: {
  label: string;
  description?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors',
        selected ? 'bg-surface-2' : 'hover:bg-surface-2/60',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm">{label}</span>
        {description && <span className="block text-[11px] text-muted">{description}</span>}
      </span>
      {selected && <Check size={14} className="mt-1 shrink-0 text-accent" />}
    </button>
  );
}
