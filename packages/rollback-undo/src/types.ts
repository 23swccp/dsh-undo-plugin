/** Public request, result, and durable-journal vocabulary for user-message rollback. */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A prompt was refused before model admission because its rollback
     * snapshot could not be made. This notification is transient: the Host
     * plugin caches it per Session for the browser composer to poll; it never
     * enters the Session log. The Host assembly's forwarded-event allowlist
     * does not include it, so browser code reads it through the
     * `admissionFailure` Remote instead of this event.
     * @param payload - physical Session, original prompt, and redacted technical detail.
     * @mode emit
     */
    'undo/admission-failed'(payload: { sessionId: SessionId; prompt: string; detail: string }): void
  }
}

/** Stored tree id owned by the plugin's private Shadow Git repository. */
export type ConversationUndoTree = Branded<'ConversationUndoTree'>

/** Stable identity shared by every physical Session in one rollback lineage. */
export type LogicalConversationId = Branded<'LogicalConversationId'>

/** Read the current physical Session's latest rollback point. */
export interface ConversationCurrentRequest {
  /** Physical Session owning the message action. */
  readonly sessionId: SessionId
}

/** Current physical Session and its one latest eligible rollback point. */
export interface ConversationUndoValue {
  /** Session owning the point, or the new current child after a rollback. */
  readonly sessionId: SessionId
  /** Latest completed eligible user message, when a point exists. */
  readonly messageId?: MessageId
  /** Text shown only with a live rollback point. */
  readonly prompt?: string
}

/** Roll back the latest completed text-only user message of a physical Session. */
export interface ConversationUndoLatestRequest {
  /** Physical source Session. */
  readonly sessionId: SessionId
  /** Eligible latest user message to remove. */
  readonly userMessageId: MessageId
}

/** Read and clear the last refused-admission failure for one physical Session. */
export interface ConversationAdmissionFailureRequest {
  /** Physical Session that refused the prompt. */
  readonly sessionId: SessionId
}

/** Resolve the rollback child a completed journal published for a source Session. */
export interface ConversationRollbackChildRequest {
  /** Physical source Session whose rollback completed. */
  readonly sessionId: SessionId
}

/** Read the retained revoke pair for one rollback child Session. */
export interface ConversationRevokePairRequest {
  /** Physical rollback child Session to inspect. */
  readonly sessionId: SessionId
}

/** A completed, still-revocable rollback pair owned by a rollback child Session. */
export interface ConversationRevokePairValue {
  /** Archived source Session the rollback removed the message from. */
  readonly sourceSessionId: SessionId
  /** Rolled-back prompt text, shown as the revoke card preview. */
  readonly prompt: string
}

/** Revoke one completed rollback from the rollback child Session it published. */
export interface ConversationRevokeRequest {
  /** Physical rollback child Session currently holding the pair. */
  readonly sessionId: SessionId
}

/** Redacted admission-failure material returned once to the browser composer. */
export interface ConversationAdmissionFailureValue {
  /** Original prompt text, verbatim. */
  readonly prompt: string
  /** Technical detail with sensitive values removed. */
  readonly detail: string
}

/** Inspect the recovery state of one archived Session for Archive Tasks. */
export interface ConversationArchiveActionRequest {
  /** Archived physical Session being rendered by Archive Tasks. */
  readonly sessionId: SessionId
}

/** Archive Tasks action derived from the retained rollback journal, if any. */
export interface ConversationArchiveActionValue {
  /** 'archived' entries allow view and tombstone deletion; cleanup/recovery states surface instead. */
  readonly action: 'archived' | 'cleanup-pending' | 'recovery-required'
}

/** Service-level business refusal callers can present without parsing an Error. */
export interface ConversationUndoFailure {
  readonly code:
    | 'no-undo'
    | 'not-latest-message'
    | 'session-busy'
    | 'workspace-unsupported'
    | 'workspace-diverged'
    | 'undo-not-ready'
    | 'rollback-in-progress'
    | 'recovery-required'
  readonly message: string
}

/** Result common to current and rollback requests. */
export type ConversationUndoResult =
  | { readonly ok: true; readonly value: ConversationUndoValue }
  | { readonly ok: false; readonly error: ConversationUndoFailure }

/** Durable manifest for exactly one source Session's latest rollback generation. */
export interface ConversationUndoJournal {
  /** Durable manifest revision understood by this pre-release provider. */
  readonly schemaVersion: 1
  /** Stable lineage identity retained when a rollback creates a child Session. */
  readonly logicalConversationId: LogicalConversationId
  /** Monotonic rollback lineage generation. */
  readonly generation: number
  /** Original physical Session that owns the prompt being removed. */
  readonly sourceSessionId: SessionId
  /** Child Session created from the prefix before the reverted prompt. */
  readonly rollbackSessionId?: SessionId
  /** Restored Session a revoke transaction is about to publish. */
  readonly revokeSessionId?: SessionId
  /** User message being removed. */
  readonly messageId: MessageId
  /** Plain-text prompt preview for the message action. */
  readonly prompt: string
  /** Canonical source workspace path. */
  readonly workspace: string
  /** Private snapshot before model admission. */
  readonly beforeTree: ConversationUndoTree
  /** Private snapshot captured immediately before rollback. */
  readonly redoTree?: ConversationUndoTree
  /** Turn containing the user message. */
  readonly turn: number
  /** Durable transaction, cleanup, or operator-recovery state. */
  readonly phase:
    | 'armed'
    | 'ready'
    | 'quiescing'
    | 'restoring'
    | 'complete'
    | 'revoking'
    | 'cleanup-pending'
    | 'recovery-required'
}
