import { useEffect, useRef, type ReactNode } from 'react';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
}

/** Diálogo modal sobre o `<dialog>` nativo: foco preso, Esc fecha e o fundo fica inerte sem biblioteca extra. */
export function Dialog({ open, onClose, title, description, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // clique no fundo
      }}
      className="m-auto w-full max-w-md rounded-2xl border border-border bg-surface p-0 text-text shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-[2px]"
    >
      {open && (
        <div className="p-6">
          <h2 className="text-base font-semibold">{title}</h2>
          {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          <div className="mt-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}
