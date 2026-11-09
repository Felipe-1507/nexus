import { MessageCircleQuestion } from 'lucide-react';
import { useState } from 'react';
import type { PermissionRequest, QuestionAnswers } from '@shared/permissions';
import { Button } from '@renderer/components/ui/Button';
import { cn } from '@renderer/lib/cn';
import { useRespondPermission } from './queries';

/** Escolha de uma pergunta: opções marcadas e, se houver, o texto livre ("Outra"). */
interface Choice {
  picked: string[];
  other: string;
}

const OTHER = 'Outra';

/** Resposta final de uma pergunta: as opções marcadas, ou o texto livre; várias opções vão separadas por vírgula. */
function answerOf(choice: Choice | undefined, multi: boolean): string {
  if (!choice) return '';
  const other = choice.picked.includes(OTHER) ? choice.other.trim() : '';
  const labels = choice.picked.filter((l) => l !== OTHER);
  if (!multi) return other || labels[0] || '';
  return [...labels, ...(other ? [other] : [])].join(', ');
}

/** O Claude perguntando com opções (AskUserQuestion): o usuário escolhe e a resposta volta ao Claude. */
export function QuestionCard({ request, queued }: { request: PermissionRequest; queued: number }) {
  const respond = useRespondPermission();
  const questions = request.questions ?? [];
  const [choices, setChoices] = useState<Record<string, Choice>>({});

  const answers: QuestionAnswers = {};
  for (const q of questions) answers[q.question] = answerOf(choices[q.question], q.multiSelect);
  const complete = questions.every((q) => answers[q.question] !== '');

  function pick(question: string, label: string, multi: boolean) {
    setChoices((prev) => {
      const current = prev[question] ?? { picked: [], other: '' };
      const picked = multi
        ? current.picked.includes(label)
          ? current.picked.filter((l) => l !== label)
          : [...current.picked, label]
        : [label];
      return { ...prev, [question]: { ...current, picked } };
    });
  }

  return (
    <div
      role="alertdialog"
      aria-label="Pergunta do Claude"
      data-testid="question-card"
      className="mb-2 rounded-2xl border border-accent/40 bg-accent/10 p-3"
    >
      <div className="flex items-center gap-2 text-sm">
        <MessageCircleQuestion size={18} className="shrink-0 text-accent" />
        <span>
          O Claude tem {questions.length === 1 ? 'uma pergunta' : `${questions.length} perguntas`}
          {queued > 0 && <span className="text-muted"> (+{queued} na fila)</span>}
        </span>
      </div>
      <div className="mt-3 flex max-h-72 flex-col gap-4 overflow-auto">
        {questions.map((q) => {
          const choice = choices[q.question];
          const otherOn = choice?.picked.includes(OTHER) ?? false;
          return (
            <fieldset key={q.question} className="min-w-0">
              <legend className="text-sm font-medium">
                <span className="mr-2 rounded-md bg-surface px-1.5 py-0.5 text-[11px] text-muted">{q.header}</span>
                {q.question}
              </legend>
              {q.multiSelect && <p className="mt-0.5 text-[11px] text-muted">Pode marcar mais de uma.</p>}
              <div className="mt-2 flex flex-col gap-1.5">
                {q.options.map((o) => {
                  const on = choice?.picked.includes(o.label) ?? false;
                  return (
                    <label
                      key={o.label}
                      className={cn(
                        'flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-1.5 text-xs hover:bg-surface',
                        on ? 'border-accent bg-surface' : 'border-border',
                      )}
                    >
                      <input
                        type={q.multiSelect ? 'checkbox' : 'radio'}
                        name={q.question}
                        checked={on}
                        onChange={() => pick(q.question, o.label, q.multiSelect)}
                        className="mt-0.5 accent-[var(--color-accent)]"
                      />
                      <span className="min-w-0">
                        <span className="font-medium">{o.label}</span>
                        {o.description && <span className="block text-muted">{o.description}</span>}
                      </span>
                    </label>
                  );
                })}
                <label
                  className={cn(
                    'flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-1.5 text-xs hover:bg-surface',
                    otherOn ? 'border-accent bg-surface' : 'border-border',
                  )}
                >
                  <input
                    type={q.multiSelect ? 'checkbox' : 'radio'}
                    name={q.question}
                    checked={otherOn}
                    onChange={() => pick(q.question, OTHER, q.multiSelect)}
                    className="mt-0.5 accent-[var(--color-accent)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{OTHER}</span>
                    {otherOn && (
                      <input
                        autoFocus
                        aria-label={`Outra resposta: ${q.question}`}
                        value={choice?.other ?? ''}
                        onChange={(e) =>
                          setChoices((prev) => ({
                            ...prev,
                            [q.question]: { picked: prev[q.question]?.picked ?? [OTHER], other: e.target.value },
                          }))
                        }
                        placeholder="Escreva sua resposta"
                        className="mt-1 w-full rounded-md border border-border bg-surface-2 px-2 py-1 text-xs outline-none focus-visible:border-accent"
                      />
                    )}
                  </span>
                </label>
              </div>
            </fieldset>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button
          className="px-3 py-1.5 text-xs"
          onClick={() => respond.mutate({ requestId: request.id, decision: 'deny' })}
          disabled={respond.isPending}
        >
          Dispensar
        </Button>
        <Button
          variant="primary"
          className="px-3 py-1.5 text-xs"
          onClick={() => respond.mutate({ requestId: request.id, decision: 'allow_once', answers })}
          disabled={respond.isPending || !complete}
        >
          Responder
        </Button>
      </div>
      {respond.isError && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {respond.error.message}
        </p>
      )}
    </div>
  );
}
