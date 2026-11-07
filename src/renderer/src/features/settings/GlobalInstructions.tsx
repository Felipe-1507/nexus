import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button } from '@renderer/components/ui/Button';
import { invoke } from '@renderer/lib/ipc';

const key = ['settings', 'global-instructions'] as const;

/** Instruções gerais: valem em todas as conversas, de todos os Workspaces (primeira camada do contexto). */
export function GlobalInstructions() {
  const queryClient = useQueryClient();
  const current = useQuery({ queryKey: key, queryFn: () => invoke('settings:getGlobalInstructions') });
  const save = useMutation({
    mutationFn: (text: string) => invoke('settings:setGlobalInstructions', { text }),
    onSuccess: (data) => queryClient.setQueryData(key, data),
  });
  const [text, setText] = useState('');
  useEffect(() => {
    if (current.data) setText(current.data.text);
  }, [current.data]);
  const dirty = current.data !== undefined && text !== current.data.text;

  return (
    <section className="rounded-2xl border border-border bg-surface p-5" data-testid="global-instructions">
      <h2 className="text-sm font-semibold">Instruções gerais</h2>
      <p className="mt-1 mb-3 text-xs leading-5 text-muted">
        Quem você é e como gosta que o Claude trabalhe, em qualquer Workspace. Ficam neste computador; na outra máquina
        você define as dela.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={!current.data}
        aria-label="Instruções gerais"
        placeholder="Ex.: Trabalho com finanças e programação. Prefiro respostas curtas, em tópicos, e que você confirme antes de apagar arquivos."
        className="min-h-28 w-full resize-y rounded-xl border border-border bg-bg p-3 font-mono text-[13px] leading-6 outline-none focus:border-accent"
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-muted">
          {save.isPending ? 'Salvando…' : dirty ? 'Alterações não salvas' : 'Salvo'}
        </span>
        <Button variant="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate(text)}>
          Salvar
        </Button>
      </div>
      {save.isError && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {save.error.message}
        </p>
      )}
    </section>
  );
}
