import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk';
import { NexusError } from '@shared/ipc-result';
import type {
  AuditEntry,
  PermissionDecision,
  PermissionMode,
  PermissionRequest,
  PermissionRule,
} from '@shared/permissions';
import type { PermissionBroker } from '../../agent/permission-broker';
import { decide, describeRequest, describeRule, suggestRule } from '../../agent/permission-policy';
import { PermissionsRepo } from '../../persistence/repositories/permissions-repo';

export interface PermissionScope {
  workspaceId: string;
  conversationId: string;
  mode: PermissionMode;
  /** Pastas de trabalho da sessão; a primeira é o cwd. */
  roots: string[];
}

/**
 * Reúne política, aprovação do usuário, regras "sempre permitir" e auditoria. Cada sessão do Claude Code recebe
 * um `canUseTool` daqui, preso ao Workspace e à conversa dela.
 */
export class PermissionsService {
  private readonly repo: PermissionsRepo;
  private readonly now: () => string;
  private readonly newId: () => string;
  private readonly platform: NodeJS.Platform | undefined;

  constructor(
    db: DatabaseSync,
    private readonly broker: PermissionBroker,
    opts: { now?: () => string; newId?: () => string; platform?: NodeJS.Platform } = {},
  ) {
    this.repo = new PermissionsRepo(db);
    this.now = opts.now ?? (() => new Date().toISOString());
    this.newId = opts.newId ?? randomUUID;
    this.platform = opts.platform;
  }

  canUseToolFor(scope: PermissionScope): CanUseTool {
    return async (tool, input, options) => {
      const record = (decision: 'allow' | 'deny', decidedBy: AuditEntry['decidedBy']) => {
        const { title, detail } = describeRequest(tool, input);
        this.repo.audit({
          workspaceId: scope.workspaceId,
          conversationId: scope.conversationId,
          tool,
          summary: title,
          detail: detail ?? null,
          decision,
          decidedBy,
          createdAt: this.now(),
        });
      };

      const verdict = decide({
        mode: scope.mode,
        roots: scope.roots,
        rules: this.repo.listRules(scope.workspaceId),
        tool,
        input,
        blockedPath: options.blockedPath,
        platform: this.platform,
      });
      if (verdict.action === 'allow') {
        // Leituras liberadas pela política não entram na auditoria (seriam milhares); regras sim.
        if (verdict.by === 'rule') record('allow', 'rule');
        return { behavior: 'allow', updatedInput: input };
      }
      if (verdict.action === 'deny') {
        record('deny', 'policy');
        return { behavior: 'deny', message: verdict.reason };
      }

      const rule = suggestRule(tool, input);
      const { title, detail } = describeRequest(tool, input);
      const answer = await this.broker.ask(
        {
          conversationId: scope.conversationId,
          workspaceId: scope.workspaceId,
          tool,
          title,
          detail,
          alwaysLabel: rule?.label,
        },
        options.signal,
      );
      if (answer === 'allow_once' || answer === 'allow_always') {
        if (answer === 'allow_always' && rule) {
          this.repo.addRule({
            id: this.newId(),
            workspaceId: scope.workspaceId,
            tool: rule.tool,
            pattern: rule.pattern,
            createdAt: this.now(),
          });
        }
        record('allow', 'user');
        return { behavior: 'allow', updatedInput: input };
      }
      record('deny', answer === 'deny' ? 'user' : answer);
      const message =
        answer === 'deny'
          ? 'O usuário negou esta ação. Não tente contorná-la; explique o que faltou fazer.'
          : answer === 'timeout'
            ? 'O usuário não respondeu ao pedido de permissão a tempo.'
            : 'O usuário interrompeu a resposta.';
      return { behavior: 'deny', message, interrupt: answer === 'cancel' };
    };
  }

  respond(requestId: string, decision: PermissionDecision): void {
    this.broker.respond(requestId, decision);
  }

  pending(): PermissionRequest[] {
    return this.broker.list();
  }

  cancelConversation(conversationId: string): void {
    this.broker.cancelConversation(conversationId);
  }

  listRules(workspaceId: string): PermissionRule[] {
    return this.repo.listRules(workspaceId).map((r) => ({ ...r, label: describeRule(r) }));
  }

  removeRule(ruleId: string): void {
    if (!this.repo.findRule(ruleId)) throw new NexusError('NOT_FOUND', 'Regra não encontrada.');
    this.repo.removeRule(ruleId);
  }

  listAudit(workspaceId: string): AuditEntry[] {
    return this.repo.listAudit(workspaceId);
  }
}
