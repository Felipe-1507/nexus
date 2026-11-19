import { Fragment, type ReactNode } from 'react';

/** O trecho com as palavras achadas em destaque (`ranges`: pares [início, fim) dentro de `text`). */
export function Highlighted({ text, ranges }: { text: string; ranges: Array<[number, number]> }) {
  const parts: ReactNode[] = [];
  let at = 0;
  ranges.forEach(([s, e], i) => {
    if (s > at) parts.push(<Fragment key={`t${i}`}>{text.slice(at, s)}</Fragment>);
    parts.push(
      <mark key={`m${i}`} className="rounded-sm bg-accent-soft px-0.5 text-inherit">
        {text.slice(s, e)}
      </mark>,
    );
    at = e;
  });
  if (at < text.length) parts.push(<Fragment key="end">{text.slice(at)}</Fragment>);
  return <>{parts}</>;
}
