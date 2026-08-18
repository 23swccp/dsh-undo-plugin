/** Per-session browser controller for the conversationUndo Remote. */

import type { MessageId } from '@deepseek-ai/dsh-client-connection/client'
import type { ObservableSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ConversationAdmissionFailureValue,
  ConversationRevokePairValue,
  ConversationUndoResult,
  ConversationUndoValue,
} from '@dsh-rollback/rollback-undo/types'

/** The mounted Remote methods used by this browser package. */
export interface ConversationUndoRemote {
  current: (request: { sessionId: SessionId }) => Promise<RemoteResult<ConversationUndoResult>>
  undoLatest: (request: {
    sessionId: SessionId
    userMessageId: MessageId
  }) => Promise<RemoteResult<ConversationUndoResult>>
  admissionFailure: (request: { sessionId: SessionId }) => Promise<RemoteResult<ConversationAdmissionFailureValue | undefined>>
  rollbackChild: (request: { sessionId: SessionId }) => Promise<RemoteResult<{ rollbackSessionId: SessionId } | undefined>>
  revokePair: (request: { sessionId: SessionId }) => Promise<RemoteResult<ConversationRevokePairValue | undefined>>
  revoke: (request: { sessionId: SessionId }) => Promise<RemoteResult<ConversationUndoResult>>
}

/** Immutable controller projection consumed through the injected hooks compartment. */
export interface ConversationUndoView {
  readonly status: 'cold' | 'loading' | 'ready' | 'error'
  readonly value: ConversationUndoValue | undefined
  /** Completed rollback pair this Session may still revoke, while the Host retains it. */
  readonly revokePair: ConversationRevokePairValue | undefined
  readonly error: string | null
}

const COLD: ConversationUndoView = Object.freeze({ status: 'cold', value: undefined, revokePair: undefined, error: null })

/** One Session-scoped observable that serializes Remote calls and publishes rollback state. */
export class ConversationUndoController implements ObservableSnapshot<ConversationUndoView> {
  private view = COLD
  private readonly listeners = new Set<() => void>()
  private load: Promise<void> | undefined
  private tail: Promise<void> = Promise.resolve()

  /** @param remote - mounted conversationUndo Remote. @param sessionId - current physical branch id. */
  constructor(
    private readonly remote: ConversationUndoRemote,
    private readonly sessionId: SessionId,
  ) {}

  getSnapshot(): ConversationUndoView {
    return this.view
  }

  /** @param listener - Observer notified after a published controller state change. @returns Disposer for the observer. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Load this physical Session's latest rollback point once. */
  async ensure(): Promise<void> {
    if (this.view.status === 'ready') return
    if (this.load !== undefined) return await this.load
    this.load = this.refresh()
    try {
      await this.load
    } finally {
      this.load = undefined
    }
  }

  /** Re-read the latest point and the revocable pair after a transcript event or transport reconnect. */
  async refresh(): Promise<void> {
    this.publish({ status: 'loading', value: this.view.value, revokePair: this.view.revokePair, error: null })
    const operation = this.tail.then(async () => {
      try {
        const [pointCarried, pairCarried] = await Promise.all([
          this.remote.current({ sessionId: this.sessionId }),
          this.remote.revokePair({ sessionId: this.sessionId }),
        ])
        if (!pointCarried.ok) {
          this.publish({ status: 'error', value: this.view.value, revokePair: this.view.revokePair, error: pointCarried.error.message })
          return
        }
        if (!pointCarried.value.ok) {
          this.publish({ status: 'error', value: this.view.value, revokePair: this.view.revokePair, error: pointCarried.value.error.message })
          return
        }
        this.publish({
          status: 'ready',
          value: pointCarried.value.value,
          revokePair: pairCarried.ok ? pairCarried.value : undefined,
          error: null,
        })
      } catch (error) {
        this.publish({
          status: 'error',
          value: this.view.value,
          revokePair: this.view.revokePair,
          error: error instanceof Error ? error.message : '回滚请求失败。',
        })
      }
    })
    this.tail = operation.then(() => undefined)
    return await operation
  }

  /** Request rollback for one latest approved user message.
   * @param messageId - Latest approved user message to remove.
   * @returns The opened child Session value, if rollback succeeds.
   */
  async undo(messageId: MessageId): Promise<ConversationUndoValue | undefined> {
    await this.ensure()
    return await this.apply(async () => await this.remote.undoLatest({
      sessionId: this.sessionId,
      userMessageId: messageId,
    }))
  }

  /** Revoke the completed rollback that published this Session.
   * @returns The restored Session value, if the revoke succeeds.
   */
  async revoke(): Promise<ConversationUndoValue | undefined> {
    await this.ensure()
    return await this.apply(
      async () => await this.remote.revoke({ sessionId: this.sessionId }),
      () => ({ value: { sessionId: this.sessionId }, revokePair: undefined }),
    )
  }

  /** Read and clear the last refused-admission failure, if any.
   * @returns The redacted failure material, or undefined when none was cached.
   */
  async admissionFailure(): Promise<ConversationAdmissionFailureValue | undefined> {
    const carried = await this.remote.admissionFailure({ sessionId: this.sessionId })
    if (!carried.ok || carried.value === undefined) return undefined
    return carried.value
  }

  /** Release browser observers held by this Session-scoped controller. */
  dispose(): void {
    this.listeners.clear()
  }

  private async apply(
    call: () => Promise<RemoteResult<ConversationUndoResult>>,
    commit?: (value: ConversationUndoValue) => Pick<ConversationUndoView, 'value' | 'revokePair'>,
  ): Promise<ConversationUndoValue | undefined> {
    const operation = this.tail.then(async () => {
      try {
        const carried = await call()
        if (!carried.ok) {
          this.publish({ status: 'error', value: this.view.value, revokePair: this.view.revokePair, error: carried.error.message })
          return undefined
        }
        if (!carried.value.ok) {
          this.publish({ status: 'error', value: this.view.value, revokePair: this.view.revokePair, error: carried.value.error.message })
          return undefined
        }
        const committed = commit?.(carried.value.value) ?? { value: carried.value.value, revokePair: this.view.revokePair }
        this.publish({ status: 'ready', ...committed, error: null })
        return carried.value.value
      } catch (error) {
        this.publish({
          status: 'error',
          value: this.view.value,
          revokePair: this.view.revokePair,
          error: error instanceof Error ? error.message : '回滚请求失败。',
        })
        return undefined
      }
    })
    this.tail = operation.then(() => undefined)
    return await operation
  }

  private publish(view: ConversationUndoView): void {
    this.view = Object.freeze(view)
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        console.error('[client-rollback-button] subscriber threw:', error)
      }
    }
  }
}
