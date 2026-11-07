import { ArrowLeft, FolderOpen, Monitor, Moon, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import { BRAND } from '@shared/brand';
import type { OpenablePath, Theme } from '@shared/ipc-contract';
import { IconButton } from '@renderer/components/ui/IconButton';
import { useLayout } from '@renderer/app/shell/layout-store';
import { ClaudeStatusPanel } from '@renderer/features/claude/ClaudeStatusPanel';
import { ThresholdsSection } from '@renderer/features/context/ThresholdsSection';
import { PrivacyText, usePrivacy } from '@renderer/features/privacy/PrivacyNotice';
import { AppearanceColors } from './AppearanceColors';
import { AttachmentsSection } from './AttachmentsSection';
import { GlobalInstructions } from './GlobalInstructions';
import { cn } from '@renderer/lib/cn';
import { useAppInfo, useOpenPath, usePreferences, useSetTheme } from './queries';

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
          <Appearance />
          <DataFolders />
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
    </Section>
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
