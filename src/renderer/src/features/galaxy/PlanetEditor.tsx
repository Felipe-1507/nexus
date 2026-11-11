import { Dices, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  DETAIL_MAX_CHARS,
  PLANET_KINDS,
  PLANET_KIND_LABELS,
  planetColors,
  type PlanetOverride,
  type PlanetStyle,
} from '@shared/planets';
import { cn } from '@renderer/lib/cn';

const SAVE_DELAY_MS = 400;

/**
 * Editor do planeta selecionado: tipo, cor, anéis, atmosfera, um novo sorteio e uma anotação. Cada mudança aparece na
 * hora na galáxia e é gravada logo depois e vale até "Voltar ao automático", que apaga as escolhas: o planeta volta a
 * refletir a nota (código, tamanho, conexões, imagens).
 */
export function PlanetEditor({
  style,
  hasOverride,
  onChange,
  onReset,
}: {
  style: PlanetStyle;
  hasOverride: boolean;
  onChange: (patch: PlanetOverride) => void;
  onReset: () => void;
}) {
  const colors = planetColors(style);
  const [detail, setDetail] = useState(style.detail);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  // Outro planeta (ou "voltar ao automático"): o texto acompanha.
  useEffect(() => setDetail(style.detail), [style.detail]);

  const field =
    'rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-xs text-white outline-none focus:border-white/40';

  return (
    <div className="mt-3 space-y-2.5 border-t border-white/10 pt-3" data-testid="planet-editor">
      <label className="flex items-center justify-between gap-2 text-xs text-white/70">
        Tipo
        <select
          aria-label="Tipo do planeta"
          value={style.kind}
          onChange={(e) => onChange({ kind: e.target.value as PlanetStyle['kind'] })}
          className={cn(field, 'w-32')}
        >
          {PLANET_KINDS.map((kind) => (
            <option key={kind} value={kind} className="text-black">
              {PLANET_KIND_LABELS[kind]}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center justify-between gap-2 text-xs text-white/70">
        <span>Cor</span>
        <span className="flex items-center gap-2">
          {style.color && (
            <button
              type="button"
              onClick={() => onChange({ color: undefined })}
              className="text-[11px] text-white/50 underline-offset-2 hover:text-white hover:underline"
            >
              automática
            </button>
          )}
          <input
            type="color"
            aria-label="Cor do planeta"
            value={style.color ?? colors.a}
            onChange={(e) => onChange({ color: e.target.value })}
            className="size-6 cursor-pointer rounded border-0 bg-transparent p-0"
          />
        </span>
      </div>

      <div className="flex items-center gap-4 text-xs text-white/70">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={style.ring}
            onChange={(e) => onChange({ ring: e.target.checked })}
            className="accent-white"
          />
          Anéis
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={style.atmosphere}
            onChange={(e) => onChange({ atmosphere: e.target.checked })}
            className="accent-white"
          />
          Atmosfera
        </label>
        <button
          type="button"
          onClick={() => onChange({ seed: Math.floor(Math.random() * 1_000_000) })}
          title="Sortear outros detalhes (faixas, manchas) mantendo o tipo"
          className="ml-auto flex items-center gap-1 rounded-lg border border-white/15 px-2 py-1 text-[11px] hover:bg-white/10"
        >
          <Dices size={12} /> Sortear
        </button>
      </div>

      <label className="block text-xs text-white/70">
        Anotação
        <textarea
          aria-label="Anotação do planeta"
          value={detail}
          maxLength={DETAIL_MAX_CHARS}
          rows={2}
          placeholder="Algo que você queira lembrar deste planeta…"
          onChange={(e) => {
            setDetail(e.target.value);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => onChange({ detail: e.target.value }), SAVE_DELAY_MS);
          }}
          className={cn(field, 'mt-1 block w-full resize-none')}
        />
      </label>

      {hasOverride ? (
        <button
          type="button"
          onClick={onReset}
          className="flex items-center gap-1 text-[11px] text-white/50 underline-offset-2 hover:text-white hover:underline"
        >
          <RotateCcw size={11} /> Voltar ao automático
        </button>
      ) : (
        <p className="text-[11px] text-white/45" data-testid="planet-auto">
          Automático: segue o conteúdo da nota. Qualquer mudança aqui passa a valer no lugar.
        </p>
      )}
    </div>
  );
}
