/**
 * One-generation user-message rollback with a private Git snapshot journal
 * (standalone plugin edition). The original dsh-internal seam version relied
 * on unpublished core APIs – agent termination, archive restoration, and
 * permanent deletion. This standalone build uses only published dsh APIs:
 * cancellation plus quiescence waiting replaces forced termination, tombstone
 * hiding replaces permanent deletion, and unarchive-based undo restoration is
 * dropped entirely.
 * @module @dsh-undo/rollback-undo
 */

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-jobs'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@dsh-undo/rollback-archive'
import type {} from '@dsh-undo/rollback-fork'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-terminal'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-workspace'
import { assertSupportedWorkspace, dataComponent, readJson, ShadowGit, writeJson } from './shadow-git.ts'
import { conversationUndoJournalSchema } from './spec.ts'
import { performPluginUpdate, pluginWorkspaceRoot } from './update.ts'
import type {
  ConversationAdmissionFailureRequest, ConversationAdmissionFailureValue, ConversationArchiveActionRequest,
  ConversationArchiveActionValue, ConversationCurrentRequest, ConversationRevokePairRequest,
  ConversationRevokePairValue, ConversationRevokeRequest, ConversationRollbackChildRequest,
  ConversationUndoFailure, ConversationUndoJournal, ConversationUndoLatestRequest, ConversationUndoResult,
  ConversationUndoValue, LogicalConversationId,
} from './types.ts'

export type * from './types.ts'

/** Deployment-owned directory for private Shadow Git repositories and journals. */
export interface Config {
  /** Absolute application-data root owned exclusively by this plugin. */
  readonly root: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** User-message rollback journal capability. */
    conversationUndo: ConversationUndoService
  }
}

/** Return direct text-only user content; every other submission is ineligible. */
function topLevelText(message: UserMessage): string | undefined {
  if (
    message.source.kind !== 'user'
    || ('delivery' in message.source && message.source.delivery === 'steer')
    || !message.content.every(block => block.type === 'text')
  ) return undefined
  return message.content.map(block => block.text).join('')
}

/** Seed a new logical lineage from its first physical Session identity. */
function initialLogicalConversationId(sessionId: SessionId): LogicalConversationId {
  return sessionId as unknown as LogicalConversationId
}

/** Transaction fields a write may clear; omitted keys leave the manifest without the field. */
type ClearableJournalField = 'rollbackSessionId' | 'redoTree' | 'revokeSessionId'

/** Copy one journal with the given optional transaction fields removed.
 * @param journal - Journal to copy.
 * @param fields - Optional fields to omit from the copy.
 * @returns A journal without the requested fields.
 */
function withoutJournalFields(journal: ConversationUndoJournal, fields: readonly ClearableJournalField[]): ConversationUndoJournal {
  const cleared = { ...journal } as Record<ClearableJournalField, unknown>
  for (const field of fields) delete cleared[field]
  return cleared as ConversationUndoJournal
}

/** Host owner of one-generation rollback journals and their private snapshots. */
export class ConversationUndoService extends TypertRemoteService {
  static inject = ['agents', 'sessions', 'sessionArchive', 'sessionFork', 'sessionPersistence', 'workspaceRegistry', 'commands']
  static Config: s<Config> = s.object({ root: s.string().min(1).required() })

  private readonly operationTails = new Map<SessionId, Promise<void>>()
  private readonly rollbackSessions = new Set<SessionId>()
  private readonly rollbackWorkspaces = new Set<string>()
  private readonly admissionFailures = new Map<SessionId, ConversationAdmissionFailureValue>()
  private readonly statWarmers = new Map<string, Promise<void>>()
  private readonly prearms = new Map<string, Promise<void>>()
  private readonly workspaceChecks = new Map<string, Promise<void>>()

  /** @param ctx - Host context with top-level agents and archive/fork capabilities. @param config - journal directory. */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'conversationUndo')
  }

  /** Create the journal root, recover durable work, and install admission listeners. */
  protected async [Service.init](): Promise<void> {
    await mkdir(this.config.root, { recursive: true })
    await this.recoverJournals()
    this.ctx.on('agent/pre-step', async (payload, next) => {
      const message = payload.messages.find(candidate => topLevelText(candidate) !== undefined)
      if (message !== undefined && !await this.arm(payload.agent, message, payload.turn)) return { kind: 'reject' }
      return await next()
    })
    this.ctx.on('agent/turn-stopping', async ({ agent, turn }) => {
      await this.markReady(agent, turn)
    })
    this.ctx.commands.register({
      name: 'undo',
      description: '回滚最近一条已完成消息:恢复文件和对话到该消息之前',
      handler: invocation => this.rollbackCommand(invocation),
    })
    this.ctx.commands.register({
      name: 'update',
      description: '更新 dsh-undo-plugin:拉取最新代码并重新构建(重启 dsh 后生效)',
      handler: invocation => this.updateCommand(invocation),
    })
  }

  /** Execute `/update`: pull, install, and rebuild this plugin's own workspace.
   * @param invocation - command invocation; no arguments are accepted.
   * @returns A human-facing summary or failure.
   */
  private async updateCommand(invocation: CommandInvocation): Promise<CommandResult> {
    if (invocation.rawInput.trim().length > 0) {
      return { kind: 'error', text: '更新 dsh-undo-plugin:拉取最新代码并重新构建(重启 dsh 后生效)' }
    }
    try {
      return { kind: 'success', text: await performPluginUpdate(pluginWorkspaceRoot()) }
    } catch (error) {
      return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Execute `/undo` for the receiving agent's latest completed message.
   * @param invocation - command invocation naming the receiving agent.
   * @returns A human-facing success or refusal.
   */
  private async rollbackCommand(invocation: CommandInvocation): Promise<CommandResult> {
    if (invocation.rawInput.trim().length > 0) {
      return { kind: 'error', text: '回滚最近一条已完成消息:恢复文件和对话到该消息之前' }
    }
    const workspace = invocation.agent.session.header.cwd
    if (workspace === undefined) {
      return { kind: 'error', text: `会话 ${invocation.agent.id} 没有工作区,无法建立回滚点。请先进入一个有 Git 工作区的会话。` }
    }
    const journal = await this.readJournal(invocation.agent.id)
    if (journal === undefined || (journal.phase !== 'armed' && journal.phase !== 'ready')) {
      return {
        kind: 'error',
        text: `会话 ${invocation.agent.id} 没有可回滚的消息。请在该会话发送一条纯文本消息并等待回答完成(工作区:${workspace})。`,
      }
    }
    const result = await this.undoLatest({
      sessionId: invocation.agent.id,
      userMessageId: journal.messageId,
    })
    if (!result.ok) return { kind: 'error', text: result.error.message }
    return { kind: 'success', text: `已回滚。新会话:${result.value.sessionId}` }
  }

  /** Read the latest rollback point directly owned by one physical Session.
   * @param request - Physical Session to inspect.
   * @returns Its latest Host-approved rollback point, when available.
   */
  @Remote('current')
  async current(request: ConversationCurrentRequest): Promise<ConversationUndoResult> {
    const journal = await this.readJournal(request.sessionId)
    if (journal?.phase === 'recovery-required') {
      return this.failure('recovery-required', '此前的回滚需要 Host 恢复；请勿在此工作区继续操作。')
    }
    if (journal?.phase !== 'armed' && journal?.phase !== 'ready') return this.success({ sessionId: request.sessionId })
    return this.success(this.viewFor(journal))
  }

  /** Read and clear the last refused-admission failure for one physical Session.
   * @param request - Physical Session that refused a prompt.
   * @returns The redacted failure once; an absent cache entry means no refusal.
   */
  @Remote('admissionFailure')
  async admissionFailure(request: ConversationAdmissionFailureRequest): Promise<ConversationAdmissionFailureValue | undefined> {
    const value = this.admissionFailures.get(request.sessionId)
    this.admissionFailures.delete(request.sessionId)
    return value
  }

  /** Resolve the child Session a completed rollback published for a source Session.
   * @param request - Physical source Session.
   * @returns The published rollback child, when the source journal completed.
   */
  @Remote('rollbackChild')
  async rollbackChild(request: ConversationRollbackChildRequest): Promise<{ rollbackSessionId: SessionId } | undefined> {
    const journal = await this.readJournal(request.sessionId)
    if (journal?.phase !== 'complete' || journal.rollbackSessionId === undefined) return undefined
    return { rollbackSessionId: journal.rollbackSessionId }
  }

  /** Read the completed rollback pair one child Session may still revoke.
   * @param request - Physical rollback child Session to inspect.
   * @returns The archived source and rolled-back prompt while the pair is retained.
   */
  @Remote('revokePair')
  async revokePair(request: ConversationRevokePairRequest): Promise<ConversationRevokePairValue | undefined> {
    const journal = await this.findPairByRollback(request.sessionId)
    if (journal?.phase !== 'complete') return undefined
    return { sourceSessionId: journal.sourceSessionId, prompt: journal.prompt }
  }

  /** Restore the archived source's full conversation and its redo tree, then archive the child.
   * @param request - Physical rollback child Session holding the completed pair.
   * @returns The restored replacement Session or a business refusal.
   */
  @Remote('revoke')
  revoke(request: ConversationRevokeRequest): Promise<ConversationUndoResult> {
    if (this.rollbackSessions.has(request.sessionId)) {
      return Promise.resolve(this.failure('rollback-in-progress', '该会话正在撤回回滚。'))
    }
    this.rollbackSessions.add(request.sessionId)
    return this.enqueue(request.sessionId, async () => {
      const journal = await this.findPairByRollback(request.sessionId)
      if (journal === undefined || journal.phase !== 'complete' || journal.redoTree === undefined) {
        return this.failure('no-undo', '此会话没有可撤回的回滚。')
      }
      const workspace = journal.workspace
      if (this.rollbackWorkspaces.has(workspace)) {
        return this.failure('rollback-in-progress', '该工作区正在回滚。')
      }
      this.rollbackWorkspaces.add(workspace)
      // A completed journal never carries revokeSessionId, so the journal
      // itself is the recoverable pre-transaction manifest.
      const recoverable: ConversationUndoJournal = journal
      try {
        const child = this.ctx.agents.get(request.sessionId)
        const retainedAgentOptions = child?.options
        if (child !== undefined && (child.status !== 'idle' || this.hasRunningDescendant(child))) {
          try {
            await this.quiesce(child)
          } catch (error) {
            return this.failure('session-busy', error instanceof Error ? error.message : String(error))
          }
        }
        try {
          await this.assertWorkspace(workspace)
        } catch (error) {
          return this.failure('workspace-unsupported', error instanceof Error ? error.message : String(error))
        }
        const shadow = new ShadowGit(workspace, this.shadowDirectory(journal))
        await this.statWarmers.get(this.shadowDirectory(journal))
        if (!await shadow.verifyMatches(journal.beforeTree)) {
          return this.failure('workspace-diverged', '回滚后工作区文件已被修改，无法安全撤回回滚。')
        }
        const redoTree = journal.redoTree
        const revokeSessionId = `conversation-undo-${randomUUID()}` as SessionId
        await this.writeJournal({ ...journal, revokeSessionId, phase: 'revoking' })
        let restored: AgentHandle | undefined
        try {
          // The fork reads only session persistence while the restore touches
          // only workspace files, so the two run concurrently. The revoking
          // journal above is already durable, so a crash mid-flight lands in
          // the same recovery state the sequential order produced.
          const forkTask = this.ctx.sessionFork.fork({
            sourceSessionId: journal.sourceSessionId,
            childSessionId: revokeSessionId,
            cut: { kind: 'completed-turn' },
            ...retainedAgentOptions === undefined ? {} : { retainedAgentOptions },
          })
          const restoreTask = shadow.restore(redoTree, journal.beforeTree)
          try {
            restored = (await forkTask).handle
            await restoreTask
          } catch (error) {
            if (restored === undefined) {
              // The fork failed while the restore may have started moving
              // files: settle it and put the worktree back on the before tree
              // before the generic recovery rewrites the journal.
              await restoreTask.catch(() => {})
              try {
                await shadow.restore(journal.beforeTree, redoTree)
              } catch (compensateError) {
                throw new AggregateError([error, compensateError], 'rollback revoke could not recover the failed fork')
              }
            }
            throw error
          }
          try {
            await this.ctx.sessionArchive.archive(request.sessionId)
          } catch (error) {
            // The child stays unarchived; compensate the file state only. The
            // outer catch disposes the restored Session and rewrites the
            // recoverable journal, so startup recovery re-evaluates the
            // transaction.
            try {
              await shadow.restore(journal.beforeTree, redoTree)
            } catch (restoreError) {
              throw new AggregateError([error, restoreError], 'rollback revoke could not recover the failed archive step')
            }
            throw error
          }
          await this.writeJournal({
            ...withoutJournalFields(journal, ['rollbackSessionId', 'redoTree', 'revokeSessionId']),
            sourceSessionId: restored.agent.id,
            phase: 'ready',
          })
          // The verify/restore steps left the shadow index stat cache cold;
          // warm it so a follow-up rollback's redoTree capture skips the
          // full-worktree stat pass, mirroring the undoLatest completion.
          const shadowDir = this.shadowDirectory(journal)
          const warmer = shadow.refreshStats()
            .catch(() => {})
            .finally(() => { this.statWarmers.delete(shadowDir) })
          this.statWarmers.set(shadowDir, warmer)
          return this.success({ sessionId: restored.agent.id })
        } catch (error) {
          const recoveries: unknown[] = [error]
          if (restored !== undefined) {
            try {
              await restored.dispose()
            } catch (disposeError) {
              recoveries.push(disposeError)
            }
          }
          try {
            await this.writeJournal(recoverable)
          } catch (journalError) {
            recoveries.push(journalError)
          }
          throw recoveries.length === 1
            ? error
            : new AggregateError(recoveries, 'rollback revoke could not recover the failed revoke')
        }
      } finally {
        this.rollbackWorkspaces.delete(workspace)
      }
    }).finally(() => { this.rollbackSessions.delete(request.sessionId) })
  }

  /** Select the recovery state the Archive Tasks page may surface for one archived Session.
   * @param request - Archived physical Session to inspect.
   * @returns The journal-derived archive-page action.
   */
  @Remote('archiveAction')
  async archiveAction(request: ConversationArchiveActionRequest): Promise<ConversationArchiveActionValue> {
    const journal = await this.readJournal(request.sessionId)
    if (journal?.phase === 'cleanup-pending' || journal?.phase === 'quiescing' || journal?.phase === 'restoring') {
      return { action: 'cleanup-pending' }
    }
    if (journal?.phase === 'recovery-required') return { action: 'recovery-required' }
    return { action: 'archived' }
  }

  /** Fork before the selected message, restore its before-tree, and archive the source.
   * @param request - Source Session and latest approved message to roll back.
   * @returns Replacement Session or a business refusal.
   */
  @Remote('undoLatest')
  undoLatest(request: ConversationUndoLatestRequest): Promise<ConversationUndoResult> {
    if (this.rollbackSessions.has(request.sessionId)) {
      return Promise.resolve(this.failure('rollback-in-progress', '该会话正在回滚。'))
    }
    this.rollbackSessions.add(request.sessionId)
    return this.enqueue(request.sessionId, async () => {
      let journal = await this.readJournal(request.sessionId)
      if (journal === undefined || journal.sourceSessionId !== request.sessionId) {
        return this.failure('no-undo', '此对话没有可回滚的消息。')
      }
      if (journal.messageId !== request.userMessageId) {
        return this.failure('not-latest-message', '只能回滚最近一条已完成消息。')
      }
      if (journal.phase !== 'armed' && journal.phase !== 'ready') {
        return this.failure('undo-not-ready', '该消息尚未完成，暂时不能回滚。')
      }
      const workspace = journal.workspace
      if (this.rollbackWorkspaces.has(workspace)) {
        return this.failure('rollback-in-progress', '该工作区正在回滚。')
      }
      this.rollbackWorkspaces.add(workspace)
      const recoverable = { ...journal, phase: 'ready' as const }
      try {
        await this.writeJournal({ ...journal, phase: 'quiescing' })
        const source = this.ctx.agents.get(journal.sourceSessionId)
        const retainedAgentOptions = source?.options
        if (source !== undefined && (source.status !== 'idle' || this.hasRunningDescendant(source))) {
          try {
            await this.quiesce(source)
          } catch (error) {
            await this.writeJournal(recoverable)
            return this.failure('session-busy', error instanceof Error ? error.message : String(error))
          }
        }
        journal = await this.readJournal(request.sessionId)
        if (journal === undefined || journal.phase !== 'quiescing') {
          return this.failure('undo-not-ready', '会话尚未静止，暂时不能回滚。')
        }
        try {
          await this.assertWorkspace(journal.workspace)
        } catch (error) {
          await this.writeJournal(recoverable)
          return this.failure('workspace-unsupported', error instanceof Error ? error.message : String(error))
        }
        const shadow = new ShadowGit(journal.workspace, this.shadowDirectory(journal))
        const redoTree = await shadow.capture()
        let child: AgentHandle | undefined
        try {
          const rollbackSessionId = `conversation-undo-${randomUUID()}` as SessionId
          const restoring: ConversationUndoJournal = {
            ...journal, rollbackSessionId, redoTree, phase: 'restoring',
          }
          await this.writeJournal(restoring)
          // The fork reads only session persistence while the restore touches
          // only workspace files, so the two run concurrently. The restoring
          // journal above is already durable, so a crash mid-flight lands in
          // the same recovery state the sequential order produced.
          const forkTask = this.ctx.sessionFork.fork({
            sourceSessionId: journal.sourceSessionId,
            childSessionId: rollbackSessionId,
            cut: { kind: 'before-user-message', messageId: journal.messageId },
            ...retainedAgentOptions === undefined ? {} : { retainedAgentOptions },
          })
          const restoreTask = shadow.restore(journal.beforeTree, redoTree)
          try {
            child = (await forkTask).handle
            await restoreTask
          } catch (error) {
            if (child === undefined) {
              // The fork failed while the restore may have started moving
              // files: settle it and put the worktree back on the redo tree
              // before the generic recovery rewrites the journal.
              await restoreTask.catch(() => {})
              try {
                await shadow.restore(redoTree, journal.beforeTree)
              } catch (compensateError) {
                throw new AggregateError([error, compensateError], 'rollback undo could not recover the failed fork')
              }
            }
            throw error
          }
          try {
            await this.ctx.sessionArchive.archive(journal.sourceSessionId)
          } catch (error) {
            // The source stays unarchived; compensate the file state only.
            // The outer catch disposes the child and rewrites the recoverable
            // journal, so startup recovery re-evaluates the transaction.
            try {
              await shadow.restore(redoTree, journal.beforeTree)
            } catch (restoreError) {
              throw new AggregateError([error, restoreError], 'rollback undo could not recover the failed archive step')
            }
            throw error
          }
          await this.writeJournal({ ...restoring, phase: 'complete' })
          // Warm the shadow index stat cache in the background and remember
          // the promise: a later revoke waits for it (or finds it done) and
          // its verify then skips the full-worktree stat pass. Failure is
          // harmless — verify falls back to a cold pass.
          const shadowDir = this.shadowDirectory(journal)
          const warmer = shadow.refreshStats()
            .catch(() => {})
            .finally(() => { this.statWarmers.delete(shadowDir) })
          this.statWarmers.set(shadowDir, warmer)
          // Pre-initialize the child generation's shadow repository in the
          // background: its first arm capture would otherwise pay the cold
          // `git add` over the whole worktree. The pre-captured tree equals
          // beforeTree (restore just materialized it), which is exactly the
          // child's first before-tree unless the user edits files first —
          // arm's incremental add then corrects it. arm awaits this promise
          // so the two never contend for the shadow index.
          const childJournal = {
            workspace: journal.workspace,
            logicalConversationId: journal.logicalConversationId,
            generation: journal.generation + 1,
          }
          const childShadowDir = this.shadowDirectory(childJournal)
          const prearm = new ShadowGit(workspace, childShadowDir).capture()
            .then(() => undefined)
            .catch(() => {})
            .finally(() => { this.prearms.delete(childShadowDir) })
          this.prearms.set(childShadowDir, prearm)
          return this.success({ sessionId: child.agent.id })
        } catch (error) {
          const recoveries: unknown[] = [error]
          if (child !== undefined) {
            try {
              await child.dispose()
            } catch (disposeError) {
              recoveries.push(disposeError)
            }
          }
          try {
            await this.writeJournal(recoverable)
          } catch (journalError) {
            recoveries.push(journalError)
          }
          throw recoveries.length === 1
            ? error
            : new AggregateError(recoveries, 'rollback undo could not recover the failed rollback')
        }
      } finally {
        this.rollbackWorkspaces.delete(workspace)
      }
    }).finally(() => { this.rollbackSessions.delete(request.sessionId) })
  }

  /** Capture an eligible prompt's before-tree before delegating model admission. */
  private async arm(agent: Agent, message: UserMessage, turn: number): Promise<boolean> {
    if (agent.session.header.origin === 'subagent') return true
    const prompt = topLevelText(message)
    const workspace = agent.session.header.cwd
    if (prompt === undefined || workspace === undefined) return true
    if (this.rollbackWorkspaces.has(workspace)) {
      this.recordAdmissionFailure(agent.id, prompt, '回滚正在进行，请稍后再试。')
      return false
    }
    return await this.enqueue(agent.id, async () => {
      try {
        if (this.rollbackWorkspaces.has(workspace)) {
          this.recordAdmissionFailure(agent.id, prompt, '回滚正在进行，请稍后再试。')
          return false
        }
        await this.assertWorkspace(workspace)
        // One journal scan serves both the lineage lookup and the stale-point
        // sweep below; the sweep deletes superseded snapshots, so reusing the
        // in-memory list also avoids a second full directory walk.
        const journals = await this.readJournals()
        const prior = journals.find(journal => journal.rollbackSessionId === agent.id)
        const draft: ConversationUndoJournal = {
          schemaVersion: 1,
          logicalConversationId: prior?.logicalConversationId ?? initialLogicalConversationId(agent.id),
          generation: (prior?.generation ?? -1) + 1,
          sourceSessionId: agent.id,
          messageId: message.id,
          prompt,
          workspace,
          beforeTree: '' as ConversationUndoJournal['beforeTree'],
          turn,
          phase: 'armed',
        }
        // A rollback may be pre-initializing this journal's shadow
        // repository in the background; wait for it (usually already
        // settled) so the two never contend for the shadow index.
        await this.prearms.get(this.shadowDirectory(draft))
        const beforeTree = await new ShadowGit(workspace, this.shadowDirectory(draft)).capture()
        await this.writeJournal({ ...draft, beforeTree })
        // Only the newest admitted prompt may own a rollback point: points
        // superseded by this admission (an older generation, or one a revoke
        // re-published under another lineage) are deleted with their Shadow
        // Git snapshots so readJournal never resolves a stale message.
        for (const stale of journals) {
          if (stale.sourceSessionId !== agent.id) continue
          if (stale.workspace === draft.workspace
            && stale.logicalConversationId === draft.logicalConversationId
            && stale.generation === draft.generation) continue
          await this.deleteJournal(stale)
        }
        // A captured journal proves this prompt crossed the admission point.
        // Tombstone cleanup runs independently so a retained source cannot
        // delay the replacement prompt's model request.
        void this.finalizePairForRollback(agent.id)
        return true
      } catch (error) {
        this.ctx.logger.warn(`rollback undo: refusing prompt because its before-tree snapshot failed: ${String(error)}`)
        this.recordAdmissionFailure(agent.id, prompt, '本地快照失败（snapshot-failed）。')
        return false
      }
    })
  }

  /** Cache one refused admission for the browser composer to poll once. */
  private recordAdmissionFailure(sessionId: SessionId, prompt: string, detail: string): void {
    this.admissionFailures.set(sessionId, { prompt, detail })
    this.ctx.emit('undo/admission-failed', { sessionId, prompt, detail })
  }

  /** Mark an admitted prompt ready after its turn closes. */
  private async markReady(agent: Agent, turn: number): Promise<void> {
    const journal = await this.readJournal(agent.id)
    if (journal?.phase !== 'armed' || journal.turn !== turn) return
    await this.writeJournal({ ...journal, phase: 'ready' })
  }

  /** Tombstone an older archived source once its rollback child admits a new prompt. */
  private async finalizePairForRollback(rollbackSessionId: SessionId): Promise<void> {
    const prior = await this.findPairByRollback(rollbackSessionId)
    if (prior === undefined || (prior.phase !== 'complete' && prior.phase !== 'cleanup-pending')) return
    try {
      const result = await this.ctx.sessionArchive.tombstone(prior.sourceSessionId)
      if (!result.ok) throw new Error(result.error.message)
      await this.deleteJournal(prior)
    } catch (error) {
      this.ctx.logger.warn(`rollback undo: deferred tombstone for "${prior.sourceSessionId}": ${String(error)}`)
      await this.writeJournal({ ...prior, phase: 'cleanup-pending' })
    }
  }

  /** Recover or surface every durable operation interrupted before Host shutdown. */
  private async recoverJournals(): Promise<void> {
    for (const journal of await this.readJournals()) {
      switch (journal.phase) {
        case 'cleanup-pending':
          await this.recoverDeferredCleanup(journal)
          break
        case 'quiescing':
          await this.writeJournal({ ...journal, phase: 'ready' })
          this.ctx.logger.warn(`rollback undo: reset interrupted pre-publication rollback for "${journal.sourceSessionId}"`)
          break
        case 'restoring':
          await this.recoverRestoring(journal)
          break
        case 'revoking':
          await this.recoverRevoking(journal)
          break
        default:
          break
      }
    }
  }

  /** Retry one deferred tombstone without preventing unrelated Host startup. */
  private async recoverDeferredCleanup(journal: ConversationUndoJournal): Promise<void> {
    try {
      const result = await this.ctx.sessionArchive.tombstone(journal.sourceSessionId)
      if (result.ok) await this.deleteJournal(journal)
    } catch (error) {
      this.ctx.logger.warn(`rollback undo: startup tombstone for "${journal.sourceSessionId}" is still deferred: ${String(error)}`)
    }
  }

  /** Complete only an independently verified restoring transaction; otherwise preserve an explicit recovery state. */
  private async recoverRestoring(journal: ConversationUndoJournal): Promise<void> {
    if (journal.rollbackSessionId === undefined || journal.redoTree === undefined) {
      await this.requireRecovery(journal, 'manifest has no rollback Session or redo tree')
      return
    }
    try {
      await this.assertWorkspace(journal.workspace)
      const shadow = new ShadowGit(journal.workspace, this.shadowDirectory(journal))
      const sourceArchived = this.ctx.workspaceRegistry.archivedSessionIds.includes(journal.sourceSessionId)
      const rollbackArchived = this.ctx.workspaceRegistry.archivedSessionIds.includes(journal.rollbackSessionId ?? ('' as SessionId))
      const rollbackExists = await this.sessionExists(journal.rollbackSessionId ?? ('' as SessionId))
      if (sourceArchived && !rollbackArchived && rollbackExists && await shadow.verifyMatches(journal.beforeTree)) {
        await this.writeJournal({ ...journal, phase: 'complete' })
        return
      }
      if (!sourceArchived && await shadow.verifyMatches(journal.redoTree ?? journal.beforeTree)) {
        if (rollbackExists) await this.hideUnpublishedChild(journal.rollbackSessionId ?? ('' as SessionId))
        await this.writeJournal({ ...journal, phase: 'ready' })
        return
      }
      await this.requireRecovery(journal, 'archive membership or private Shadow Git tree does not describe a safe publication state')
    } catch (error) {
      await this.requireRecovery(journal, error instanceof Error ? error.message : String(error))
    }
  }

  /** Determine whether a rollback child is present in either live or durable session ownership. */
  private async sessionExists(sessionId: SessionId): Promise<boolean> {
    return this.ctx.sessions.get(sessionId) !== undefined
      || (await this.ctx.sessionPersistence.list()).some(header => header.id === sessionId)
  }

  /** Hide an unpublished rollback child; without a termination API it stays on disk but out of every UI. */
  private async hideUnpublishedChild(sessionId: SessionId): Promise<void> {
    const agent = this.ctx.agents.get(sessionId)
    if (agent !== undefined) {
      if (agent.status !== 'idle') {
        agent.cancel({ kind: 'user' })
        await this.waitForAgentIdle(agent, Date.now() + 2000)
      }
      if (agent.status !== 'idle') throw new Error(`rollback child "${sessionId}" did not quiesce and cannot be hidden`)
    }
    await this.ctx.sessionArchive.archive(sessionId)
  }

  /** Complete only an independently verified revoke transaction; otherwise preserve an explicit recovery state. */
  private async recoverRevoking(journal: ConversationUndoJournal): Promise<void> {
    if (journal.rollbackSessionId === undefined || journal.revokeSessionId === undefined || journal.redoTree === undefined) {
      await this.requireRecovery(journal, 'revoke manifest is missing its child Session, restored Session, or redo tree')
      return
    }
    const revokeSessionId: SessionId = journal.revokeSessionId
    try {
      await this.assertWorkspace(journal.workspace)
      const shadow = new ShadowGit(journal.workspace, this.shadowDirectory(journal))
      const revokeExists = await this.sessionExists(revokeSessionId)
      const childArchived = this.ctx.workspaceRegistry.archivedSessionIds.includes(journal.rollbackSessionId)
      const revokeArchived = this.ctx.workspaceRegistry.archivedSessionIds.includes(revokeSessionId)
      if (childArchived && !revokeArchived && revokeExists && await shadow.verifyMatches(journal.redoTree)) {
        await this.writeJournal({
          ...withoutJournalFields(journal, ['rollbackSessionId', 'redoTree', 'revokeSessionId']),
          sourceSessionId: revokeSessionId,
          phase: 'ready',
        })
        return
      }
      if (!childArchived && await shadow.verifyMatches(journal.beforeTree)) {
        if (revokeExists) await this.hideUnpublishedChild(revokeSessionId)
        await this.writeJournal({ ...withoutJournalFields(journal, ['revokeSessionId']), phase: 'complete' })
        return
      }
      await this.requireRecovery(journal, 'archive membership or private Shadow Git tree does not describe a safe revoke state')
    } catch (error) {
      await this.requireRecovery(journal, error instanceof Error ? error.message : String(error))
    }
  }

  /** Preserve a recovery-required manifest instead of claiming an ambiguous transaction succeeded. */
  private async requireRecovery(journal: ConversationUndoJournal, detail: string): Promise<void> {
    await this.writeJournal({ ...journal, phase: 'recovery-required' })
    this.ctx.logger.error(`rollback undo: rollback for "${journal.sourceSessionId}" requires recovery: ${detail}`)
  }

  /** Detect live child work that makes a file restoration unsafe. */
  private hasRunningDescendant(root: Agent): boolean {
    return this.ownedAgentTree(root).some(agent => agent !== root && agent.status !== 'idle')
  }

  /** Request cooperative stop and force-stop registered work before touching tracked files. */
  private async quiesce(source: Agent): Promise<void> {
    const agents = this.ownedAgentTree(source)
    for (const agent of agents) {
      if (agent.status !== 'idle') agent.cancel({ kind: 'user' })
    }
    await this.waitForQuiescence(agents)
    if (agents.some(agent => agent.status !== 'idle') || this.hasControlledActivity(agents)) {
      await this.forceStopControlledActivity(agents)
    }
    const deadline = Date.now() + 2000
    while ((agents.some(agent => agent.status !== 'idle') || this.hasControlledActivity(agents)) && Date.now() < deadline) {
      await new Promise<void>(resolve => { setTimeout(resolve, 50) })
    }
    const runningAgents = agents.filter(agent => this.ctx.agents.get(agent.id) !== undefined && agent.status !== 'idle')
    if (runningAgents.length > 0 || this.hasControlledActivity(agents)) {
      throw new Error(`会话仍有 ${String(runningAgents.length)} 个运行任务或受控进程，无法安全回滚。`)
    }
  }

  /** Check whether registered job or terminal providers still own work for the Agent tree. */
  private hasControlledActivity(agents: readonly Agent[]): boolean {
    const jobs = this.ctx.get('jobs')
    const terminals = this.ctx.get('terminals')
    return agents.some(agent =>
      (jobs?.list(agent).some(job => job.status === 'running' || job.status === 'stopping') ?? false)
      || (terminals?.hasOwnerActivity(agent) ?? false),
    )
  }

  /** Force-stop registered jobs and PTYs only after the cooperative grace period elapses. */
  private async forceStopControlledActivity(agents: readonly Agent[]): Promise<void> {
    const jobs = this.ctx.get('jobs')
    const terminals = this.ctx.get('terminals')
    const stops: Promise<unknown>[] = []
    for (const agent of agents) {
      if (jobs !== undefined) {
        for (const job of jobs.list(agent)) {
          if (job.status === 'running' || job.status === 'stopping') jobs.kill(job.id, agent, 'rollback quiescence')
        }
      }
      if (terminals !== undefined) {
        for (const terminal of terminals.list(agent)) {
          if (terminal.status.kind === 'running') stops.push(terminals.kill(agent, terminal.sessionId, 'rollback quiescence'))
        }
      }
    }
    await Promise.all(stops)
  }

  /** Resolve the source and all transitive runtime-owned descendants. */
  private ownedAgentTree(root: Agent): Agent[] {
    const descendants = new Set<Agent>([root])
    const agents = this.ctx.agents.list()
    let changed = true
    while (changed) {
      changed = false
      for (const candidate of agents) {
        if (descendants.has(candidate)) continue
        if ([...descendants].some(parent => this.ctx.agents.isOwnedBy(candidate.id, parent))) {
          descendants.add(candidate)
          changed = true
        }
      }
    }
    return [...descendants]
  }

  /** Give Agents, registered jobs, and PTYs a short chance to stop cooperatively. */
  private async waitForQuiescence(agents: readonly Agent[]): Promise<void> {
    const deadline = Date.now() + 500
    while ((agents.some(agent => agent.status !== 'idle') || this.hasControlledActivity(agents)) && Date.now() < deadline) {
      await new Promise<void>(resolve => { setTimeout(resolve, 25) })
    }
  }

  /** Poll one Agent until idle or the deadline passes. */
  private async waitForAgentIdle(agent: Agent, deadline: number): Promise<void> {
    while (Date.now() < deadline) {
      await new Promise<void>(resolve => { setTimeout(resolve, 50) })
      if (agent.status === 'idle') return
    }
  }

  /** Assert workspace support once per workspace per Host run.
   * The worktree and submodule facts a passing check establishes cannot
   * regress while this Host owns the workspace, and the check's
   * `ls-files --stage` output scales with the whole tracked tree, so every
   * prompt admission re-running it dominates the arm cost. A failing check
   * is not cached.
   * @param workspace - Candidate worktree root.
   * @returns Resolution only for a supported non-bare, submodule-free worktree.
   */
  private assertWorkspace(workspace: string): Promise<void> {
    let check = this.workspaceChecks.get(workspace)
    if (check === undefined) {
      check = assertSupportedWorkspace(workspace)
      this.workspaceChecks.set(workspace, check)
      void check.catch(() => { this.workspaceChecks.delete(workspace) })
    }
    return check
  }

  /** Read the journal directly owned by a source Session. */
  private async readJournal(sourceSessionId: SessionId): Promise<ConversationUndoJournal | undefined> {
    return (await this.readJournals()).find(journal => journal.sourceSessionId === sourceSessionId)
  }

  /** Find the retained source journal for a rollback child. */
  private async findPairByRollback(rollbackSessionId: SessionId): Promise<ConversationUndoJournal | undefined> {
    return (await this.readJournals()).find(journal => journal.rollbackSessionId === rollbackSessionId)
  }

  /** Read every durable journal; an absent private directory is empty state. */
  private async readJournals(): Promise<ConversationUndoJournal[]> {
    let workspaceDirectories: string[]
    try {
      workspaceDirectories = await readdir(join(this.config.root, 'undo'))
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const journals: ConversationUndoJournal[] = []
    for (const workspaceDirectory of workspaceDirectories) {
      let conversationDirectories: string[]
      try {
        conversationDirectories = await readdir(join(this.config.root, 'undo', workspaceDirectory))
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw error
      }
      for (const conversationDirectory of conversationDirectories) {
        let generationDirectories: string[]
        try {
          generationDirectories = await readdir(join(this.config.root, 'undo', workspaceDirectory, conversationDirectory))
        } catch (error: unknown) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
          throw error
        }
        for (const generationDirectory of generationDirectories) {
          const journal = await readJson(
            join(this.config.root, 'undo', workspaceDirectory, conversationDirectory, generationDirectory, 'manifest.json'),
            conversationUndoJournalSchema,
          )
          if (journal !== undefined) journals.push(journal)
        }
      }
    }
    return journals
  }

  /** Convert one journal into the message-action response. */
  private viewFor(journal: ConversationUndoJournal): ConversationUndoValue {
    return { sessionId: journal.sourceSessionId, messageId: journal.messageId, prompt: journal.prompt }
  }

  /** Create a stable success response. */
  private success(value: ConversationUndoValue): ConversationUndoResult {
    return { ok: true, value }
  }

  /** Create a stable business refusal. */
  private failure(code: ConversationUndoFailure['code'], message: string): ConversationUndoResult {
    return { ok: false, error: { code, message } }
  }

  /** One private journal path, partitioned by workspace, lineage, and generation. */
  private journalDirectory(journal: Pick<ConversationUndoJournal, 'workspace' | 'logicalConversationId' | 'generation'>): string {
    return join(
      this.config.root,
      'undo',
      createHash('sha256').update(journal.workspace).digest('hex'),
      dataComponent(journal.logicalConversationId),
      String(journal.generation),
    )
  }

  /** Private Shadow Git repository paired to one journal. */
  private shadowDirectory(journal: Pick<ConversationUndoJournal, 'workspace' | 'logicalConversationId' | 'generation'>): string {
    return join(this.journalDirectory(journal), 'shadow-git')
  }

  /** Persist one journal phase transition. */
  private async writeJournal(journal: ConversationUndoJournal): Promise<void> {
    await writeJson(join(this.journalDirectory(journal), 'manifest.json'), conversationUndoJournalSchema.parse(journal))
  }

  /** Remove one exact journal and its private snapshots after tombstoning. */
  private async deleteJournal(journal: ConversationUndoJournal): Promise<void> {
    await rm(this.journalDirectory(journal), { recursive: true, force: true })
  }

  /** Serialize all journal mutations for one physical source Session. */
  private enqueue<T>(sessionId: SessionId, operation: () => Promise<T>): Promise<T> {
    const prior = this.operationTails.get(sessionId) ?? Promise.resolve()
    const result = prior.then(operation, operation)
    const tail = result.then(() => undefined, () => undefined)
    this.operationTails.set(sessionId, tail)
    return result.finally(() => {
      if (this.operationTails.get(sessionId) === tail) this.operationTails.delete(sessionId)
    })
  }
}

export default ConversationUndoService
