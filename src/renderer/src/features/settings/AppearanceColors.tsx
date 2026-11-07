import { Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PALETTE } from '@shared/brand';
import { ACCENT_PRESETS, DARK_VARIANT_IDS, DARK_VARIANTS, withAppearance, type Appearance } from '@shared/palette';
import { applyAppearance } from '@renderer/lib/appearance';
import { cn } from '@renderer/lib/cn';
import { useAppearance, useSetAppearance } from './queries';

const CUSTOM_SAVE_DELAY_MS = 300;

/** Variação do tema escuro e cor de destaque. Tudo muda na hora, inclusive a barra de título e o editor de código. */
export function AppearanceColors() {
  const appearance = useAppearance();
  const set = useSetAppearance();
  const value: Appearance | undefined = appearance.data && {
    ...appearance.data,
    ...(set.isPending ? set.variables : {}),
  };
  if (!value) return null;

  return (
    <div className="mt-6 space-y-6">
      <div>
        <p className="text-xs font-medium">Tema escuro</p>
        <p className="mt-0.5 text-xs text-muted">
          Vale quando o app está no tema escuro (ou no do sistema, se ele for escuro).
        </p>
        <div role="radiogroup" aria-label="Tema escuro" className="mt-2 grid grid-cols-4 gap-2">
          {DARK_VARIANT_IDS.map((id) => {
            const colors = withAppearance(PALETTE, { darkVariant: id, accent: value.accent }).dark;
            const checked = value.darkVariant === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={() => set.mutate({ darkVariant: id })}
                className={cn(
                  'overflow-hidden rounded-xl border text-left transition-colors focus-visible:outline-2 focus-visible:outline-accent',
                  checked ? 'border-accent ring-1 ring-accent' : 'border-border hover:border-muted',
                )}
              >
                {/* Prévia com as cores da variação: fundo, painel e destaque. */}
                <span className="flex h-12 gap-1 p-1.5" style={{ background: colors.bg }} aria-hidden>
                  <span className="w-1/3 rounded-md" style={{ background: colors.surface }} />
                  <span
                    className="flex flex-1 flex-col justify-end gap-1 rounded-md p-1"
                    style={{ background: colors['surface-2'] }}
                  >
                    <span className="h-1.5 w-3/4 rounded-full" style={{ background: colors['text-muted'] }} />
                    <span className="h-1.5 w-1/2 rounded-full" style={{ background: colors.accent }} />
                  </span>
                </span>
                <span className="block px-2 py-1.5 text-xs">{DARK_VARIANTS[id].label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <AccentPicker value={value} onPick={(accent) => set.mutate({ accent })} />

      {set.isError && (
        <p role="alert" className="text-xs text-danger">
          Não foi possível salvar as cores: {set.error.message}
        </p>
      )}
    </div>
  );
}

function AccentPicker({ value, onPick }: { value: Appearance; onPick: (accent: string | null) => void }) {
  const brandAccent = PALETTE.dark.accent.slice(0, 7);
  const isPreset = ACCENT_PRESETS.some((p) => p.hex === value.accent);
  const [custom, setCustom] = useState(isPreset || !value.accent ? brandAccent : value.accent);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div>
      <p className="text-xs font-medium">Cor de destaque</p>
      <p className="mt-0.5 text-xs text-muted">
        Botões, seleções e indicadores. No tema claro ela fica um pouco mais escura.
      </p>
      <div role="radiogroup" aria-label="Cor de destaque" className="mt-2 flex flex-wrap items-center gap-2">
        {ACCENT_PRESETS.map((preset) => {
          const hex = preset.hex ?? brandAccent;
          const checked = value.accent === preset.hex;
          return (
            <button
              key={preset.label}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={preset.label}
              title={preset.label}
              onClick={() => onPick(preset.hex)}
              className={cn(
                'grid size-8 place-items-center rounded-full ring-offset-2 ring-offset-surface transition focus-visible:outline-2 focus-visible:outline-accent',
                checked && 'ring-2 ring-text',
              )}
              style={{ background: hex }}
            >
              {checked && <Check size={14} className="text-white drop-shadow" />}
            </button>
          );
        })}
        <label
          className={cn(
            'flex h-8 cursor-pointer items-center gap-2 rounded-full border px-3 text-xs transition-colors',
            !isPreset && value.accent ? 'border-accent text-text' : 'border-border text-muted hover:text-text',
          )}
        >
          <input
            type="color"
            aria-label="Cor personalizada"
            value={custom}
            onChange={(e) => {
              const hex = e.target.value;
              setCustom(hex);
              // Prévia imediata enquanto arrasta; grava quando o usuário para de mexer.
              applyAppearance({ ...value, accent: hex });
              clearTimeout(timer.current);
              timer.current = setTimeout(() => onPick(hex), CUSTOM_SAVE_DELAY_MS);
            }}
            className="size-5 cursor-pointer rounded-full border-0 bg-transparent p-0"
          />
          Personalizada
        </label>
      </div>
    </div>
  );
}
