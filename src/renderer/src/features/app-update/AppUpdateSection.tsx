import { useEffect, useState } from 'react';
import { Button } from '@renderer/components/ui/Button';
import {
  useAppUpdateSettings,
  useAppUpdateStatus,
  useCheckAppUpdate,
  useInstallAppUpdate,
  useSetAppUpdateSource,
} from './queries';

/** Configurações → Atualizações do Nexus: de onde vêm as versões novas e o botão de instalar. */
export function AppUpdateSection() {
  const settings = useAppUpdateSettings();
  const status = useAppUpdateStatus();
  const save = useSetAppUpdateSource();
  const check = useCheckAppUpdate();
  const install = useInstallAppUpdate();
  const saved = settings.data?.source ?? '';
  const [source, setSource] = useState(saved);
  useEffect(() => setSource(saved), [saved]);
  const s = status.data;

  return (
    <section className="rounded-2xl border border-border bg-surface p-5" data-testid="app-update-section">
      <h2 className="text-sm font-semibold">Atualizações do Nexus</h2>
      <p className="mt-1 text-xs text-muted">
        Aponte para a pasta (local ou de rede) ou o endereço HTTPS onde as versões são publicadas com{' '}
        <code>npm run publish:update</code>. O Nexus consulta ao abrir e, com a sua confirmação, confere o instalador
        (SHA-512), instala em silêncio e reabre. Vazio, a atualização fica desligada.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <input
          value={source}
          onChange={(e) => setSource(e.target.value)}
          onBlur={() => source.trim() !== saved && save.mutate(source.trim() || null)}
          placeholder="\\servidor\nexus-versoes   ou   https://…"
          aria-label="Pasta ou endereço das atualizações"
          className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-2.5 py-1.5 font-mono text-xs outline-none focus:border-accent"
          data-testid="app-update-source"
        />
        <Button onClick={() => check.mutate()} disabled={check.isPending || !saved} data-testid="app-update-check">
          {check.isPending ? 'Consultando…' : 'Verificar agora'}
        </Button>
      </div>
      {save.isError && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {save.error.message}
        </p>
      )}
      {s?.configured && (
        <p className="mt-3 text-xs" data-testid="app-update-status">
          {s.error ? (
            <span className="text-danger">{s.error}</span>
          ) : s.available ? (
            <span>
              Versão <strong>{s.latest}</strong> disponível (você tem {s.current}).
            </span>
          ) : (
            <span className="text-muted">Você está na versão mais nova ({s.current}).</span>
          )}
        </p>
      )}
      {s?.available && !s.error && (
        <div className="mt-3">
          <Button
            variant="primary"
            onClick={() => install.mutate()}
            disabled={install.isPending || install.isSuccess}
            data-testid="app-update-install"
          >
            {install.isPending || install.isSuccess ? 'Instalando… o Nexus vai fechar e reabrir' : 'Atualizar agora'}
          </Button>
        </div>
      )}
      {install.isError && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {install.error.message}
        </p>
      )}
    </section>
  );
}
