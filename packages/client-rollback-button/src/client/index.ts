/** Browser-half Cordis composition for the rollback header action. */

import type { ClientContext, ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import TYPERT_REMOTE from '@dsh-rollback/rollback-undo/remote'
import type {} from '@dsh-rollback/rollback-undo/remote'
import { ConversationUndoController } from './controller.ts'
import type { ConversationUndoRemote } from './controller.ts'
import { RollbackHeaderAction } from './RollbackHeaderAction.tsx'
import type { RollbackActionInjected } from './RollbackHeaderAction.tsx'
import { RollbackFold } from './RollbackFold.tsx'
import type { RollbackFoldInjected } from './RollbackFold.tsx'

/** Required service and slot declarations. The Remote namespaces are mounted by this apply, so only the `remote` service is injected. */
export const inject = ['slots', 'remote', 'sessions']

/** Browser surface of the workspaces runtime list store. */
interface WorkspacesListPort {
  getSnapshot(): { archivedSessionIds: readonly SessionId[] }
  subscribe(fn: () => void): () => void
}

/** Browser surface of the workspaces runtime service. */
interface WorkspacesPort {
  list: WorkspacesListPort
}

/**
 * Mount one generated contribution at most once across sibling client plugins.
 * Both rollback browser packages mount the conversationUndo contribution; the
 * typert registry rejects a duplicate endpoint, so the later apply must
 * observe the earlier mount and skip.
 * @param ctx - client Cordis context.
 * @param contribution - generated Remote contribution.
 * @param probe - one endpoint the contribution declares, used to test the registry.
 * @returns the contribution disposer (a no-op when a sibling already mounted it).
 */
async function mountOnce(
  ctx: ClientContext,
  contribution: TypertRemoteContribution,
  probe: string,
): Promise<() => Promise<void>> {
  if (ctx.get('typert')?.remotes.get(probe) !== undefined) return async () => {}
  return await ctx.remote.$mount(contribution)
}

/** Mount the plugin Remote and register the session-header rollback action. */
export async function apply(ctx: ClientContext): Promise<() => void> {
  const disposeRemote = await mountOnce(ctx, TYPERT_REMOTE, 'conversationUndo/current')
  const sessions = ctx.get('sessions') as unknown as Pick<ISessions, 'open'>
  const workspaces = ctx.get('workspaces') as WorkspacesPort | undefined
  const undoRemote = ctx.get('remote.conversationUndo') as ConversationUndoRemote
  const controllers = new Map<SessionId, ConversationUndoController>()
  const controllerFor = (sessionId: SessionId): ConversationUndoController => {
    let controller = controllers.get(sessionId)
    if (controller === undefined) {
      controller = new ConversationUndoController(undoRemote, sessionId)
      controllers.set(sessionId, controller)
      void controller.ensure()
    }
    return controller
  }
  const disposeFollow = followRollbackChild(workspaces, sessions, undoRemote)
  const disposeRegistration = ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'rollback',
    order: 60,
    inject: (sessionId: SessionId): RollbackActionInjected => {
      const controller = controllerFor(sessionId)
      return {
        hooks: { undo: controller },
        refresh: () => { void controller.refresh() },
        checkAdmissionFailure: () => controller.admissionFailure(),
        undo: async (messageId) => {
          const result = await controller.undo(messageId)
          if (result !== undefined) sessions.open(result.sessionId)
        },
      }
    },
  }, RollbackHeaderAction))

  const disposeFold = ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'rollback-fold',
    order: 60,
    inject: (sessionId: SessionId): RollbackFoldInjected => {
      const controller = controllerFor(sessionId)
      return {
        hooks: { undo: controller },
        refresh: () => { void controller.refresh() },
        revoke: async () => {
          const result = await controller.revoke()
          if (result !== undefined) sessions.open(result.sessionId)
        },
      }
    },
  }, RollbackFold))

  ctx.on('connection/reset', () => {
    for (const controller of controllers.values()) void controller.refresh()
  })

  return () => {
    disposeRegistration()
    disposeFold()
    disposeFollow()
    for (const controller of controllers.values()) controller.dispose()
    controllers.clear()
    void disposeRemote()
  }
}

/**
 * Open the rollback child of every freshly archived Session that carries a
 * completed rollback journal. A text-command rollback archives its source
 * through the Host; the workspaces projection then clears the current
 * selection, and following it into the published child keeps the workflow
 * continuous. Manual archives without a journal are untouched.
 * @param workspaces - workspaces runtime service, when present.
 * @param sessions - sessions runtime service.
 * @param undoRemote - mounted conversationUndo Remote.
 * @returns Disposer for the archive listener.
 */
function followRollbackChild(
  workspaces: WorkspacesPort | undefined,
  sessions: Pick<ISessions, 'open'>,
  undoRemote: ConversationUndoRemote,
): () => void {
  if (workspaces === undefined) return () => {}
  let prevArchived: readonly SessionId[] = workspaces.list.getSnapshot().archivedSessionIds
  return workspaces.list.subscribe(() => {
    const archived = workspaces.list.getSnapshot().archivedSessionIds
    for (const id of archived) {
      if (prevArchived.includes(id)) continue
      void undoRemote.rollbackChild({ sessionId: id }).then(carried => {
        const child = carried.ok ? carried.value : undefined
        if (child !== undefined) sessions.open(child.rollbackSessionId)
      })
    }
    prevArchived = archived
  })
}
