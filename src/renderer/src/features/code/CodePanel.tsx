import { DiffEditor, Editor } from '@monaco-editor/react';
import { ArrowLeft, Code2, Pencil, Save, SquareArrowOutUpRight } from 'lucide-react';
import type { editor } from 'monaco-editor';
import { useEffect, useRef, useState } from 'react';
import type { CodeScope } from '@shared/code';
import type { NexusError } from '@shared/ipc-result';
import { Button } from '@renderer/components/ui/Button';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { IconButton } from '@renderer/components/ui/IconButton';
import { useLayout } from '@renderer/app/shell/layout-store';
import { useChat } from '@renderer/features/chat/chat-store';
import { useActiveWorkspace } from '@renderer/features/workspaces/queries';
import { invoke } from '@renderer/lib/ipc';
import { monacoOptions, useMonacoTheme } from '@renderer/lib/monaco';
import { useCodeFile, useFileChanges, useOpenInVsCode } from './queries';

const baseName = (p: string) => p.split(/[\\/]/).pop() || p;

/** Aba "Código": pasta do escopo atual (projeto ou Workspace), arquivo aberto ou diff de uma resposta. */
export function CodePanel() {
  const workspace = useActiveWorkspace();
  const projectId = useChat((s) => (workspace ? (s.scope[workspace.id] ?? null) : null));
  const opened = useLayout((s) => s.openedCode);
  const diff = useLayout((s) => s.openedDiff);

  if (!workspace) {
    return (
      <EmptyState
        className="flex-1"
        icon={<Code2 size={18} />}
        title="Nenhum arquivo aberto"
        description="Arquivos de projeto e alterações feitas pelo Claude aparecem aqui."
      />
    );
  }
  const scope: CodeScope = { workspaceId: workspace.id, projectId };
  if (diff && diff.workspaceId === workspace.id) {
    return (
      <DiffView key={`${diff.messageId}:${diff.path}`} scope={scope} messageId={diff.messageId} path={diff.path} />
    );
  }
  if (opened && opened.workspaceId === workspace.id && opened.projectId === projectId) {
    return <FileView key={`${projectId}:${opened.path}`} scope={scope} path={opened.path} />;
  }
  return (
    <EmptyState
      className="flex-1"
      icon={<Code2 size={18} />}
      title="Nenhum arquivo aberto"
      description="Escolha um arquivo nas pastas do projeto, na barra lateral. As alterações feitas pelo Claude também abrem aqui."
    />
  );
}

/** Arquivo aberto: leitura por padrão; "Editar" libera pequenas edições, gravadas com Ctrl+S ou no botão. */
function FileView({ scope, path }: { scope: CodeScope; path: string }) {
  const file = useCodeFile(scope, path);
  const theme = useMonacoTheme();
  const openCode = useLayout((s) => s.openCode);
  const vscode = useOpenInVsCode();
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<'saved' | 'dirty' | 'saving' | 'conflict' | { error: string }>('saved');
  // O editor guarda o texto (sem `value` controlado, que perde teclas digitadas rápido); recarregar remonta.
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const [revision, setRevision] = useState(0);
  // Data de modificação da versão que está no editor: gravar só se o arquivo ainda for essa versão.
  const mtime = useRef(0);

  async function save() {
    const content = editorRef.current?.getValue();
    if (content === undefined || !editing) return;
    setStatus('saving');
    try {
      const r = await invoke('code:write', { ...scope, path, content, expectedMtimeMs: mtime.current });
      mtime.current = r.mtimeMs;
      setStatus('saved');
    } catch (err) {
      const e = err as NexusError;
      setStatus(e.code === 'CONFLICT' ? 'conflict' : { error: e.message });
    }
  }
  // O atalho do Monaco é registrado uma vez; o ref sempre aponta para o save atual.
  const saveRef = useRef(save);
  saveRef.current = save;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="code-file">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <IconButton label="Fechar arquivo" className="size-7" onClick={() => openCode(null)}>
          <ArrowLeft size={14} />
        </IconButton>
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={path}>
          {path}
        </span>
        {editing && (
          <span className="text-[11px] text-muted" data-testid="code-status">
            {status === 'saved' && 'Salvo'}
            {status === 'dirty' && 'Não salvo'}
            {status === 'saving' && 'Salvando…'}
            {status === 'conflict' && <span className="text-danger">Alterado por fora</span>}
            {typeof status === 'object' && <span className="text-danger">Erro</span>}
          </span>
        )}
        {editing ? (
          <IconButton
            label="Salvar arquivo"
            className="size-7"
            disabled={status !== 'dirty'}
            onClick={() => void save()}
          >
            <Save size={13} />
          </IconButton>
        ) : (
          file.data?.content != null && (
            <IconButton label="Editar arquivo" className="size-7" onClick={() => setEditing(true)}>
              <Pencil size={13} />
            </IconButton>
          )
        )}
        <IconButton label="Abrir no VS Code" className="size-7" onClick={() => vscode.mutate({ ...scope, path })}>
          <SquareArrowOutUpRight size={13} />
        </IconButton>
      </div>
      {status === 'conflict' && (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 border-b border-danger/40 bg-danger/10 px-3 py-1.5 text-xs"
        >
          O arquivo mudou fora do editor (talvez pelo Claude).
          <Button
            className="px-2 py-1 text-xs"
            onClick={async () => {
              await file.refetch();
              setStatus('saved');
              setRevision((r) => r + 1);
            }}
          >
            Recarregar
          </Button>
        </div>
      )}
      {(file.isError || vscode.isError || typeof status === 'object') && (
        <p role="alert" className="px-3 py-1 text-xs text-danger">
          {typeof status === 'object' ? status.error : (file.error ?? vscode.error)?.message}
        </p>
      )}
      <div className="min-h-0 flex-1">
        {file.data?.reason === 'binary' && <Notice text="Arquivo binário: não é possível mostrar aqui." />}
        {file.data?.reason === 'too_large' && <Notice text="Arquivo grande demais para abrir aqui (mais de 2 MB)." />}
        {file.data?.content != null && (
          <Editor
            key={revision}
            path={path}
            defaultValue={file.data.content}
            theme={theme}
            onChange={() => setStatus('dirty')}
            onMount={(instance, monaco) => {
              editorRef.current = instance;
              mtime.current = file.data?.mtimeMs ?? 0;
              instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void saveRef.current());
            }}
            options={{ ...monacoOptions, readOnly: !editing, domReadOnly: !editing }}
          />
        )}
      </div>
    </div>
  );
}

/** Diff de um arquivo alterado pelo Claude numa resposta: antes à esquerda, depois à direita. */
function DiffView({ scope, messageId, path }: { scope: CodeScope; messageId: string; path: string }) {
  const changes = useFileChanges(messageId);
  const theme = useMonacoTheme();
  const openDiff = useLayout((s) => s.openDiff);
  const openCode = useLayout((s) => s.openCode);
  const vscode = useOpenInVsCode();
  const [relative, setRelative] = useState<string | null>(null);
  const change = changes.data?.find((c) => c.path === path);

  useEffect(() => {
    invoke('code:relative', { ...scope, absolute: path })
      .then((r) => setRelative(r.path))
      .catch(() => setRelative(null));
  }, [scope.workspaceId, scope.projectId, path]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="code-diff">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <IconButton label="Fechar diff" className="size-7" onClick={() => openDiff(null)}>
          <ArrowLeft size={14} />
        </IconButton>
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={path}>
          {baseName(path)}
        </span>
        {change && (
          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">
            {change.kind === 'create' ? 'Criado' : 'Editado'} pelo Claude
          </span>
        )}
        {relative && (
          <>
            <Button className="px-2 py-1 text-xs" onClick={() => openCode({ ...scope, path: relative })}>
              Ver arquivo atual
            </Button>
            <IconButton
              label="Abrir no VS Code"
              className="size-7"
              onClick={() => vscode.mutate({ ...scope, path: relative })}
            >
              <SquareArrowOutUpRight size={13} />
            </IconButton>
          </>
        )}
      </div>
      {changes.isError && (
        <p role="alert" className="px-3 py-1 text-xs text-danger">
          {changes.error.message}
        </p>
      )}
      <div className="min-h-0 flex-1">
        {changes.data && !change && (
          <Notice text="Não há registro desta alteração (respostas antigas não guardavam o diff)." />
        )}
        {change?.truncated && <Notice text="Arquivo grande demais para mostrar o diff." />}
        {change && !change.truncated && (
          <DiffEditor
            original={change.before ?? ''}
            modified={change.after ?? ''}
            originalModelPath={`antes/${baseName(path)}`}
            modifiedModelPath={`depois/${baseName(path)}`}
            theme={theme}
            options={{ ...monacoOptions, readOnly: true, renderSideBySide: false, originalEditable: false }}
          />
        )}
      </div>
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return <p className="p-4 text-xs text-muted">{text}</p>;
}
