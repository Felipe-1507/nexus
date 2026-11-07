import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { cn } from '@renderer/lib/cn';

interface ResizerProps {
  label: string;
  /** Lado do painel em relação ao divisor: o painel à esquerda cresce arrastando para a direita, e o da direita ao contrário. */
  side: 'left' | 'right';
  width: number;
  min: number;
  max: number;
  defaultWidth: number;
  onResize: (width: number) => void;
  onDraggingChange?: (dragging: boolean) => void;
}

/** Divisor arrastável e acessível por teclado (setas ajustam, duplo clique restaura). */
export function Resizer({ label, side, width, min, max, defaultWidth, onResize, onDraggingChange }: ResizerProps) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const direction = side === 'left' ? 1 : -1;

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, width };
    onDraggingChange?.(true);
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    onResize(start.current.width + (e.clientX - start.current.x) * direction);
  }
  function onPointerUp() {
    start.current = null;
    onDraggingChange?.(false);
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === 'ArrowLeft') onResize(width - step * direction);
    else if (e.key === 'ArrowRight') onResize(width + step * direction);
    else return;
    e.preventDefault();
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => onResize(defaultWidth)}
      onKeyDown={onKeyDown}
      className={cn(
        'group relative z-10 w-0 shrink-0 cursor-col-resize outline-none',
        'before:absolute before:inset-y-0 before:-left-1 before:w-2',
      )}
    >
      <span className="absolute inset-y-0 -left-px w-0.5 bg-transparent transition-colors group-hover:bg-accent/50 group-focus-visible:bg-accent" />
    </div>
  );
}
