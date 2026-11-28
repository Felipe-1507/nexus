import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@renderer/components/ui/Button';
import { Dialog } from '@renderer/components/ui/Dialog';
import { invoke } from '@renderer/lib/ipc';

const privacyKey = ['privacy'] as const;

export function usePrivacy() {
  return useQuery({ queryKey: privacyKey, queryFn: () => invoke('privacy:get'), staleTime: Infinity });
}

/** Liga ou desliga a consulta de versão nova do Claude Code (a única ida à internet que não é pedida pelo usuário). */
export function useSetClaudeUpdateCheck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (claudeUpdateCheck: boolean) => invoke('privacy:set', { claudeUpdateCheck }),
    onSuccess: (data) => {
      queryClient.setQueryData(privacyKey, data);
      void queryClient.invalidateQueries({ queryKey: ['claude', 'update'] });
    },
  });
}

/** O que acontece com os dados. Aparece na primeira execução e fica em Configurações → Privacidade. */
export function PrivacyText() {
  return (
    <ul className="list-disc space-y-2 pl-4 text-sm leading-6 text-muted">
      <li>
        O Nexus conversa com o Claude pelo Claude Code instalado neste computador, com a sua conta. O que você escreve,
        e o conteúdo dos arquivos que o Claude lê, é enviado à <strong className="text-text">Anthropic</strong> para ser
        processado, conforme os termos da sua conta.
      </li>
      <li>O Nexus não guarda senhas nem tokens: o login é o do próprio Claude Code.</li>
      <li>
        Conversas, notas e configurações ficam neste computador. O Nexus não tem servidor próprio nem telemetria. Fora o
        Claude, ele só acessa a internet para ver no registro público do npm se há versão nova do Claude Code (dá para
        desligar em Configurações → Privacidade) e para buscar atualizações do Nexus, se você configurar um endereço em
        Configurações → Atualizações.
      </li>
      <li>
        A tela de boas-vindas pode pedir ao Claude um resumo do dia, com os títulos de commits, notas e conversas do
        período. Dá para desligar em Configurações → Boas-vindas.
      </li>
      <li>
        No modo Auto (o padrão), o Claude edita arquivos dentro da pasta do Workspace ou do projeto sem perguntar.
        Comandos e qualquer coisa fora da pasta pedem sua confirmação. O modo pode ser trocado em cada Workspace.
      </li>
    </ul>
  );
}

/** Aviso de privacidade da primeira execução. Só fecha confirmando: Esc e clique no fundo não fecham. */
export function PrivacyNoticeHost() {
  const queryClient = useQueryClient();
  const privacy = usePrivacy();
  const accept = useMutation({
    mutationFn: () => invoke('privacy:accept'),
    onSuccess: (data) => queryClient.setQueryData(privacyKey, data),
  });

  return (
    <Dialog open={privacy.data?.acceptedAt === null} onClose={() => undefined} title="Antes de começar">
      <PrivacyText />
      {accept.isError && (
        <p role="alert" className="mt-3 text-xs text-danger">
          Não foi possível salvar: {accept.error.message}
        </p>
      )}
      <div className="mt-6 flex justify-end">
        <Button variant="primary" disabled={accept.isPending} onClick={() => accept.mutate()}>
          Entendi
        </Button>
      </div>
    </Dialog>
  );
}
