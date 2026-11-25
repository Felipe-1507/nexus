import { ArrowLeft, FolderOpen, Monitor, Moon, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import { BRAND } from '@shared/brand';
import { PALETTE } from '@shared/brand';
import type { GalaxyLook, GalaxyQuality, OpenablePath, Theme } from '@shared/ipc-contract';
import { IconButton } from '@renderer/components/ui/IconButton';
import { useLayout } from '@renderer/app/shell/layout-store';
import { ClaudeStatusPanel } from '@renderer/features/claude/ClaudeStatusPanel';
import { ThresholdsSection } from '@renderer/features/context/ThresholdsSection';
import { PrivacyText, usePrivacy } from '@renderer/features/privacy/PrivacyNotice';
import { ExtensionsSection } from '@renderer/features/extensions/ExtensionsSection';
import { AppUpdateSection } from '@renderer/features/app-update/AppUpdateSection';
import { BackupSection } from '@renderer/features/backup/BackupSection';
import { WelcomeSection } from '@renderer/features/welcome/WelcomeSection';
import { AppearanceColors } from './AppearanceColors';
import { AttachmentsSection } from './AttachmentsSection';
import { GlobalInstructions } from './GlobalInstructions';
import { cn } from '@renderer/lib/cn';
import {
  useAppInfo,
  useGalaxyLook,
  useGalaxyQuality,
  useSetGalaxyLook,
  useOpenPath,
  usePreferences,
  useSetGalaxyQuality,
  useSetTheme,
} from './queries';

const themes: Array<{ id: Theme; label: string; icon: ReactNode }> = [
  { id: 'system', label: 'Sistema', icon: <Monitor size={16} /> },
  { id: 'light', label: 'Claro', icon: <Sun size={16} /> },
  { id: 'dark', label: 'Escuro', icon: <Moon size={16} /> },
];

export function SettingsView() {
  const setView = useLayout((s) => s.setView);

  return (
    <div className="h-full overflow-y-auto" data-testid="settings-view">
      <div className="mx-auto max-w-2xl px-8 py-8">
        <div className="mb-8 flex items-center gap-2">
          <IconButton label="Voltar ao chat (Esc)" onClick={() => setView('chat')}>
            <ArrowLeft size={16} />
          </IconButton>
          <h1 className="text-lg font-semibold tracking-tight">Configurações</h1>
        </div>
        <div className="space-y-6">
          <ClaudeStatusPanel />
          <GlobalInstructions />
          <ExtensionsSection />
          <Appearance />
          <WelcomeSection />
          <DataFolders />
          <BackupSection />
          <AppUpdateSection />
          <AttachmentsSection />
          <ThresholdsSection />
          <Privacy />
          <About />
        </div>
      </div>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {description && <p className="mt-1 text-xs text-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Appearance() {
  const prefs = usePreferences();
  const setTheme = useSetTheme();
  const current = setTheme.isPending ? setTheme.variables : prefs.data?.theme;

  return (
    <Section title="Aparência" description="O tema também vale para os botões da janela.">
      <div role="radiogroup" aria-label="Tema" className="grid grid-cols-3 gap-2">
        {themes.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={current === t.id}
            disabled={!prefs.data}
            onClick={() => setTheme.mutate(t.id)}
            className={cn(
              'flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition-colors',
              'focus-visible:outline-2 focus-visible:outline-accent',
              current === t.id
                ? 'border-accent bg-accent-soft text-text'
                : 'border-border text-muted hover:bg-surface-2 hover:text-text',
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
      {setTheme.isError && (
        <p role="alert" className="mt-2 text-xs text-danger">
          Não foi possível salvar o tema: {setTheme.error.message}
        </p>
      )}
      <AppearanceColors />
      <GalaxyLookPicker />
      <GalaxyQualityPicker />
    </Section>
  );
}

const GALAXY_LOOKS: Array<{ id: GalaxyLook; label: string; description: string }> = [
  {
    id: 'atual',
    label: 'Atual',
    description: 'Um sol no centro, com os sistemas girando em volta dele.',
  },
  {
    id: 'eclipse',
    label: 'Eclipse',
    description: 'Um buraco negro no centro, com disco de luz e poeira em órbita. Combina com os dois modos abaixo.',
  },
];

/** Miniatura do centro de cada estilo, desenhada com as cores da galáxia (nenhuma imagem guardada). */
function LookPreview({ look }: { look: GalaxyLook }) {
  const [gold, , sky, , amber] = PALETTE.galaxy;
  return (
    <svg viewBox="0 0 120 64" aria-hidden className="h-16 w-full rounded-lg bg-[#05050b]">
      <defs>
        <radialGradient id={`look-glow-${look}`}>
          <stop offset="0%" stopColor={gold} stopOpacity="0.9" />
          <stop offset="100%" stopColor={gold} stopOpacity="0" />
        </radialGradient>
      </defs>
      {[0.12, 0.28, 0.52, 0.77, 0.91].map((x, i) => (
        <circle key={i} cx={x * 120} cy={[10, 52, 14, 50, 26][i]} r="0.8" fill="#ffffff" opacity="0.5" />
      ))}
      {look === 'atual' ? (
        <>
          <ellipse cx="60" cy="32" rx="46" ry="14" fill="none" stroke={sky} strokeOpacity="0.35" />
          <circle cx="104" cy="30" r="2.4" fill={sky} />
          <circle cx="22" cy="36" r="2" fill={amber} />
          <circle cx="60" cy="32" r="22" fill={`url(#look-glow-${look})`} />
          <circle cx="60" cy="32" r="8" fill={gold} />
        </>
      ) : (
        <>
          <circle cx="60" cy="32" r="22" fill={`url(#look-glow-${look})`} opacity="0.35" />
          <ellipse cx="60" cy="32" rx="34" ry="9" fill="none" stroke={amber} strokeWidth="5" strokeOpacity="0.55" />
          <ellipse cx="60" cy="32" rx="34" ry="9" fill="none" stroke={gold} strokeWidth="1.6" strokeOpacity="0.9" />
          <path d="M42 28 Q60 8 78 28" fill="none" stroke={gold} strokeWidth="2" strokeOpacity="0.85" />
          <circle cx="60" cy="32" r="11" fill="#000000" />
          <circle cx="60" cy="32" r="11" fill="none" stroke={gold} strokeWidth="1.2" />
        </>
      )}
    </svg>
  );
}

function GalaxyLookPicker() {
  const look = useGalaxyLook();
  const set = useSetGalaxyLook();
  const current = set.isPending ? set.variables : look.data?.look;
  return (
    <div className="mt-6">
      <p className="text-xs font-medium">Estilo da galáxia</p>
      <p className="mt-0.5 text-xs text-muted">
        Muda só o centro e o ambiente. Posições, planetas e personalizações continuam iguais, e a troca vale na hora.
      </p>
      <div role="radiogroup" aria-label="Estilo da galáxia" className="mt-2 grid grid-cols-2 gap-2">
        {GALAXY_LOOKS.map((l) => (
          <button
            key={l.id}
            type="button"
            role="radio"
            aria-checked={current === l.id}
            disabled={!look.data}
            onClick={() => set.mutate(l.id)}
            className={cn(
              'rounded-xl border p-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-accent',
              current === l.id ? 'border-accent bg-accent-soft' : 'border-border hover:bg-surface-2',
            )}
          >
            <LookPreview look={l.id} />
            <span className="mt-2 block text-sm">{l.label}</span>
            <span className="mt-0.5 block text-xs leading-5 text-muted">{l.description}</span>
          </button>
        ))}
      </div>
      {set.isError && (
        <p role="alert" className="mt-2 text-xs text-danger">
          Não foi possível salvar o estilo da galáxia: {set.error.message}
        </p>
      )}
    </div>
  );
}

const GALAXY_QUALITIES: Array<{ id: GalaxyQuality; label: string; description: string }> = [
  {
    id: 'auto',
    label: 'Automático',
    description: 'Começa no Ultra e desce um nível sozinho se a galáxia ficar lenta neste computador.',
  },
  {
    id: 'leve',
    label: 'Leve',
    description:
      'Para o dia a dia: menos partículas e efeitos ao mesmo tempo, movimento a 30 quadros e parado sem foco.',
  },
  {
    id: 'original',
    label: 'Original',
    description: 'A experiência completa, com todos os efeitos. Gasta mais placa de vídeo.',
  },
  {
    id: 'alta',
    label: 'Alta',
    description: 'Todos os efeitos com acabamento de cinema: brilho nas luzes, cor mais rica, vinheta e grão leve.',
  },
  {
    id: 'ultra',
    label: 'Ultra',
    description: 'Tudo no máximo: mais estrelas e poeira, brilho mais forte e resolução maior. Para placa de vídeo dedicada.',
  },
];

function GalaxyQualityPicker() {
  const quality = useGalaxyQuality();
  const set = useSetGalaxyQuality();
  const current = set.isPending ? set.variables : quality.data?.quality;
  return (
    <div className="mt-6">
      <p className="text-xs font-medium">Galáxia</p>
      <p className="mt-0.5 text-xs text-muted">
        Muda só o quanto é desenhado. Posições, cores e planetas personalizados continuam iguais em todos os modos.
      </p>
      <div role="radiogroup" aria-label="Modo da galáxia" className="mt-2 grid grid-cols-2 gap-2">
        {GALAXY_QUALITIES.map((q) => (
          <button
            key={q.id}
            type="button"
            role="radio"
            aria-checked={current === q.id}
            disabled={!quality.data}
            onClick={() => set.mutate(q.id)}
            className={cn(
              'rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-accent',
              current === q.id ? 'border-accent bg-accent-soft' : 'border-border hover:bg-surface-2',
            )}
          >
            <span className="block text-sm">{q.label}</span>
            <span className="mt-0.5 block text-xs leading-5 text-muted">{q.description}</span>
          </button>
        ))}
      </div>
      {set.isError && (
        <p role="alert" className="mt-2 text-xs text-danger">
          Não foi possível salvar o modo da galáxia: {set.error.message}
        </p>
      )}
    </div>
  );
}

function DataFolders() {
  const info = useAppInfo();
  const open = useOpenPath();
  const rows: Array<{ key?: OpenablePath; label: string; path?: string }> = [
    { label: 'Conteúdo (Workspaces e notas)', path: info.data?.paths.dataRoot },
    { key: 'userData', label: 'Dados do app', path: info.data?.paths.userData },
    { key: 'logs', label: 'Logs', path: info.data?.paths.logs },
  ];

  return (
    <Section title="Pastas" description="Tudo fica no seu computador. Nada é enviado para a nuvem do Nexus.">
      <dl className="space-y-3">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <dt className="text-xs text-muted">{row.label}</dt>
              <dd className="truncate font-mono text-xs" title={row.path}>
                {row.path ?? '…'}
              </dd>
            </div>
            {row.key && (
              <IconButton label={`Abrir pasta: ${row.label}`} onClick={() => open.mutate(row.key!)}>
                <FolderOpen size={15} />
              </IconButton>
            )}
          </div>
        ))}
      </dl>
      {open.isError && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {open.error.message}
        </p>
      )}
    </Section>
  );
}

function Privacy() {
  const acceptedAt = usePrivacy().data?.acceptedAt;
  return (
    <Section title="Privacidade">
      <PrivacyText />
      {acceptedAt && (
        <p className="mt-3 text-xs text-muted">
          Aviso confirmado em {new Date(acceptedAt).toLocaleDateString('pt-BR')}.
        </p>
      )}
    </Section>
  );
}

function About() {
  const info = useAppInfo();
  const d = info.data;
  return (
    <Section title="Sobre">
      {info.isError && (
        <p role="alert" className="text-sm text-danger">
          Falha ao consultar o núcleo: {info.error.message}
        </p>
      )}
      {d && (
        <dl className="grid grid-cols-[9rem_1fr] gap-y-1.5 text-xs" data-testid="app-status">
          <dt className="text-muted">Versão</dt>
          <dd>
            {BRAND.productName} {d.appVersion}
          </dd>
          <dt className="text-muted">Banco de dados</dt>
          <dd>
            schema v{d.database.schemaVersion} · SQLite {d.database.sqliteVersion}
          </dd>
          <dt className="text-muted">Plataforma</dt>
          <dd>
            Electron {d.versions.electron} · Node {d.versions.node} · Chromium {d.versions.chrome}
          </dd>
        </dl>
      )}
      <p className="mt-4 border-t border-border pt-3 text-xs" data-testid="app-credits">
        <span className="text-muted">Desenvolvido por: </span>
        <span className="font-medium">Felipe Ferreira</span>
        <span className="text-muted"> · </span>
        <ExternalLink href="https://felipeferreira.dev">felipeferreira.dev</ExternalLink>
        <span className="text-muted"> · </span>
        <ExternalLink href="https://github.com/Felipe-1507">GitHub</ExternalLink>
      </p>
    </Section>
  );
}

/** Link externo: o main só abre endereços https, no navegador padrão. */
function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-accent"
    >
      {children}
    </a>
  );
}
