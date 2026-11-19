import { FileText, MessageSquare, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { PALETTE } from '@shared/brand';
import type { Conversation } from '@shared/chat';
import { cn } from '@renderer/lib/cn';
import { formatMessageTime } from '@renderer/lib/format-time';
import { HOME_DAYS, HOME_WEEK_DAYS, type HomeStats } from './home-stats';

interface HomePanelProps {
  stats: HomeStats;
  /** Cor de cada sistema na galáxia (a mesma dos planetas). */
  systemColors: Map<string, string>;
  /** Conversas mais recentes do Workspace (só títulos e datas: nada é resumido nem gerado). */
  conversations: Conversation[];
  now: number;
  onFocusNote: (index: number) => void;
  onFrameSystem: (indices: number[]) => void;
  onOpenConversation: (conversation: Conversation) => void;
  onClose: () => void;
}

const SYSTEM_ROWS = 7;
const tint = (i: number) => PALETTE.galaxy[i] ?? 'var(--accent)';
const KPI_TINTS = [tint(2), tint(5), tint(1), tint(0)] as const;

/**
 * Painel Home sobre a galáxia (GE1): números do Workspace, atividade e atalhos que levam a câmera até um sistema ou uma
 * nota. Não é modal: a galáxia atrás continua girando e respondendo ao mouse fora do painel.
 */
export function HomePanel({
  stats,
  systemColors,
  conversations,
  now,
  onFocusNote,
  onFrameSystem,
  onOpenConversation,
  onClose,
}: HomePanelProps) {
  const maxSystem = Math.max(1, ...stats.bySystem.map((s) => s.count));
  const maxDay = Math.max(1, ...stats.perDay);
  const maxDegree = Math.max(1, ...stats.topConnected.map((n) => n.degree));
  const week = stats.perDay.slice(-HOME_WEEK_DAYS);
  const maxWeek = Math.max(1, ...week);
  const avgLinks = stats.notes === 0 ? 0 : (2 * stats.links) / stats.notes;
  const firstDay = new Date(now - (HOME_DAYS - 1) * 86_400_000);

  return (
    <section
      aria-label="Painel da galáxia"
      data-testid="galaxy-home"
      className="absolute top-[5.5rem] bottom-4 left-4 flex w-[min(36rem,calc(100%-2rem))] flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/65 text-white backdrop-blur-md"
    >
      <header className="flex items-center gap-2 px-4 pt-3 pb-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">Painel do Workspace</h2>
        <button
          type="button"
          aria-label="Fechar o painel"
          title="Fechar (Esc)"
          onClick={onClose}
          className="rounded-md p-1 text-white/60 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white/60"
        >
          <X size={14} />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="home-kpis">
          <Kpi label="Notas" value={stats.notes} hint={`${stats.orphans} sem ligação`} tint={KPI_TINTS[0]} />
          <Kpi
            label="Rotas"
            value={stats.links}
            hint={`${avgLinks.toFixed(1).replace('.', ',')} por nota`}
            tint={KPI_TINTS[1]}
          />
          <Kpi
            label="Sistemas"
            value={stats.systems}
            hint={`${stats.attachments} ${stats.attachments === 1 ? 'anexo' : 'anexos'}`}
            tint={KPI_TINTS[2]}
          />
          <Kpi label="Na semana" value={stats.updatedWeek} hint="notas alteradas" tint={KPI_TINTS[3]}>
            <div className="mt-1.5 flex h-5 items-end gap-0.5" aria-hidden>
              {week.map((n, i) => (
                <span
                  key={i}
                  className="flex-1 rounded-[1px]"
                  style={{
                    height: `${n === 0 ? 8 : 20 + (80 * n) / maxWeek}%`,
                    background: KPI_TINTS[3],
                    opacity: n === 0 ? 0.25 : 0.9,
                  }}
                />
              ))}
            </div>
          </Kpi>
        </div>

        <Card title="Notas alteradas por dia" subtitle={`últimos ${HOME_DAYS} dias`}>
          <div className="flex h-16 items-end gap-0.5" role="img" aria-label={dayChartLabel(stats.perDay)}>
            {stats.perDay.map((n, i) => {
              const day = new Date(now - (HOME_DAYS - 1 - i) * 86_400_000);
              return (
                <span
                  key={i}
                  title={`${formatDay(day)}: ${n} ${n === 1 ? 'nota' : 'notas'}`}
                  className="flex-1 rounded-t-[2px] bg-[var(--accent)]"
                  style={{ height: `${n === 0 ? 3 : 12 + (88 * n) / maxDay}%`, opacity: n === 0 ? 0.2 : 0.95 }}
                />
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-white/40" aria-hidden>
            <span>{formatDay(firstDay)}</span>
            <span>hoje</span>
          </div>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2">
          <Card title="Notas por sistema" subtitle="clique para ir até ele">
            <ul className="space-y-1" data-testid="home-systems">
              {stats.bySystem.slice(0, SYSTEM_ROWS).map((s) => (
                <li key={s.name || '__nucleo'}>
                  <button
                    type="button"
                    onClick={() => onFrameSystem(s.indices)}
                    title={`Enquadrar ${s.name || 'o núcleo'} na galáxia`}
                    className="group block w-full rounded-md px-1 py-0.5 text-left hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white/60"
                  >
                    <span className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="min-w-0 truncate">{s.name || 'Núcleo'}</span>
                      <span className="shrink-0 text-white/55 tabular-nums">{s.count}</span>
                    </span>
                    <span className="mt-0.5 block h-1 overflow-hidden rounded-full bg-white/10">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${(100 * s.count) / maxSystem}%`,
                          background: systemColors.get(s.name) ?? 'var(--accent)',
                        }}
                      />
                    </span>
                  </button>
                </li>
              ))}
              {stats.bySystem.length > SYSTEM_ROWS && (
                <li className="px-1 pt-0.5 text-[11px] text-white/40">
                  + {stats.bySystem.length - SYSTEM_ROWS}{' '}
                  {stats.bySystem.length - SYSTEM_ROWS === 1 ? 'sistema' : 'sistemas'}
                </li>
              )}
            </ul>
          </Card>

          <Card title="Mais conectadas" subtitle="rotas de e para a nota">
            <ul className="space-y-1" data-testid="home-connected">
              {stats.topConnected.length === 0 && (
                <li className="text-xs text-white/45">Nenhum link entre notas ainda.</li>
              )}
              {stats.topConnected.map((n) => (
                <li key={n.index}>
                  <button
                    type="button"
                    onClick={() => onFocusNote(n.index)}
                    className="block w-full rounded-md px-1 py-0.5 text-left hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white/60"
                  >
                    <span className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="min-w-0 truncate">{n.title}</span>
                      <span className="shrink-0 text-white/55 tabular-nums">{n.degree}</span>
                    </span>
                    <span className="mt-0.5 block h-1 overflow-hidden rounded-full bg-white/10">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${(100 * n.degree) / maxDegree}%`,
                          background: systemColors.get(n.system) ?? 'var(--accent)',
                        }}
                      />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Card title="Notas recentes">
            <ul className="space-y-0.5" data-testid="home-recent-notes">
              {stats.recent.map((n) => (
                <RecentRow
                  key={n.index}
                  icon={<FileText size={12} />}
                  title={n.title}
                  detail={`${n.system || 'Núcleo'} · ${formatMessageTime(new Date(n.mtimeMs).toISOString(), new Date(now))}`}
                  onClick={() => onFocusNote(n.index)}
                />
              ))}
            </ul>
          </Card>
          <Card title="Conversas recentes">
            <ul className="space-y-0.5" data-testid="home-recent-conversations">
              {conversations.length === 0 && <li className="text-xs text-white/45">Nenhuma conversa ainda.</li>}
              {conversations.map((c) => (
                <RecentRow
                  key={c.id}
                  icon={<MessageSquare size={12} />}
                  title={c.title}
                  detail={formatMessageTime(c.updatedAt, new Date(now))}
                  onClick={() => onOpenConversation(c)}
                />
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </section>
  );
}

function Kpi({
  label,
  value,
  hint,
  tint,
  children,
}: {
  label: string;
  value: number;
  hint: string;
  tint: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2" style={{ borderTopColor: tint }}>
      <p className="text-[10px] tracking-wide text-white/50 uppercase">{label}</p>
      <p className="text-2xl leading-tight font-semibold tabular-nums">{value.toLocaleString('pt-BR')}</p>
      <p className="truncate text-[11px] text-white/45">{hint}</p>
      {children}
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
      <h3 className="mb-2 flex items-baseline justify-between gap-2 text-[11px] tracking-wide text-white/60 uppercase">
        <span>{title}</span>
        {subtitle && <span className="truncate text-[10px] tracking-normal text-white/35 normal-case">{subtitle}</span>}
      </h3>
      {children}
    </div>
  );
}

function RecentRow({
  icon,
  title,
  detail,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'flex w-full items-start gap-2 rounded-md px-1 py-1 text-left hover:bg-white/10',
          'focus-visible:outline-2 focus-visible:outline-white/60',
        )}
      >
        <span className="mt-0.5 shrink-0 text-white/45">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs">{title}</span>
          <span className="block truncate text-[10px] text-white/40">{detail}</span>
        </span>
      </button>
    </li>
  );
}

const formatDay = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;

function dayChartLabel(perDay: number[]): string {
  const total = perDay.reduce((a, b) => a + b, 0);
  return `Notas alteradas por dia nos últimos ${HOME_DAYS} dias: ${total} no total`;
}
