/** Session-header action that starts a reversible rollback of the latest completed message. */

import { useEffect, useRef, useState } from 'react'
import type { MessageId } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationAdmissionFailureValue } from '@dsh-rollback/rollback-undo/types'
import type { ConversationUndoController } from './controller.ts'
import css from './RollbackHeaderAction.module.css'

/** Injected callbacks and observable source for the header action. */
export interface RollbackActionInjected {
  hooks: { undo: ConversationUndoController }
  refresh: () => void
  /** Read and clear one refused-admission failure for this Session. */
  checkAdmissionFailure: () => Promise<ConversationAdmissionFailureValue | undefined>
  /** Roll back the latest approved message and open the replacement Session. */
  undo: (messageId: MessageId) => Promise<void>
}

/** Full action props, derived from the declared header-actions slot. */
export type RollbackActionProps = PropsRuntime<'conversation.session.header.actions'> & InjectFace<RollbackActionInjected>

/** Compose the non-durable draft restored after snapshot admission fails.
 * @param prompt - Original rejected text.
 * @param detail - Redacted Host failure detail.
 * @returns Composer draft recovery text.
 */
export function formatAdmissionFailureDraft(prompt: string, detail: string): string {
  return `${prompt}\n---------\n失败原因:\n${detail}`
}

/** Render while the Host holds a rollback point for this Session's latest eligible message. */
export function RollbackHeaderAction({
  useSession, inputActions, useUndo, refresh, checkAdmissionFailure, undo,
}: RollbackActionProps) {
  const session = useSession(value => value)
  const view = useUndo(value => value)
  const [pending, setPending] = useState(false)
  const previousRunning = useRef(session.running)
  useEffect(() => {
    if (previousRunning.current && !session.running) {
      void checkAdmissionFailure().then(failure => {
        if (failure !== undefined) {
          inputActions?.setDraft(formatAdmissionFailureDraft(failure.prompt, failure.detail))
        }
      })
    }
    previousRunning.current = session.running
  }, [checkAdmissionFailure, inputActions, session.running])
  useEffect(() => {
    if (!session.running) refresh()
  }, [refresh, session.running])
  const messageId = view.value?.messageId
  if (messageId === undefined) return null
  return (
    <button
      type="button"
      className={css.action}
      disabled={pending || session.running}
      title="恢复此消息发送前的文件和对话。此消息之后的本地修改会丢失。"
      aria-label="回滚到此消息之前"
      onClick={() => {
        setPending(true)
        void undo(messageId).finally(() => { setPending(false) })
      }}
    >
      {pending ? '回滚中' : '回滚'}
    </button>
  )
}

/** Re-export the session identity type for the apply closure. */
export type { SessionId }
