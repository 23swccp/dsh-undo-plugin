/** Public request and result vocabulary for archived Sessions. */

import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** One archived Session visible in the Settings archive task list. */
export interface ArchivedSessionItem {
  /** Persisted Session identity. */
  readonly sessionId: SessionId
  /** Latest durable title, when the Session has one. */
  readonly title?: string
  /** Instant this Session entered the global archive set, in Unix milliseconds. */
  readonly archivedAt: number
  /** Session creation instant in Unix milliseconds. */
  readonly createdAt: number
  /** Original working directory, when the Session declared one. */
  readonly cwd?: string
}

/** One text message rendered by the Archive Tasks read-only viewer. */
export interface ArchivedSessionTranscriptMessage {
  /** Whether the preserved text was written by the user or assistant. */
  readonly role: 'user' | 'assistant'
  /** Text blocks retained in their logged order. */
  readonly text: string
}

/** Read-only archived Session data for the Settings viewer. */
export interface ArchivedSessionReadValue {
  /** Session identity retained by the archive collection. */
  readonly sessionId: SessionId
  /** Latest durable title, when the Session has one. */
  readonly title?: string
  /** Text conversation that can be viewed without restoring the Session. */
  readonly messages: readonly ArchivedSessionTranscriptMessage[]
}

/** Current ordered archive task list. */
export interface SessionArchiveListValue {
  /** Entries follow the Host registry-global archive order. */
  readonly items: readonly ArchivedSessionItem[]
}

/** Session addressed by a read or tombstone request. */
export interface SessionArchiveSessionRequest {
  /** Archived Session identity. */
  readonly sessionId: SessionId
}

/** Successful archive-task mutation result. */
export interface SessionArchiveMutationValue {
  /** Requested mutation postcondition was reached. */
  readonly changed: true
  /** Restored replacement Session, when the mutation created one. */
  readonly sessionId?: SessionId
}

/** One bulk-deletion outcome for a single archived Session. */
export interface SessionArchiveDeleteFailure {
  /** Session that could not be erased. */
  readonly sessionId: SessionId
  /** Business refusal or backend message. */
  readonly message: string
}

/** Result of erasing every non-tombstoned archived Session. */
export interface SessionArchiveDeleteAllValue {
  /** Sessions whose log directories were removed. */
  readonly deleted: readonly SessionId[]
  /** Sessions that refused deletion, with the reason. */
  readonly failed: readonly SessionArchiveDeleteFailure[]
}

/** Expected archive task failure that callers can present without parsing errors. */
export interface SessionArchiveFailure {
  readonly code: 'not-archived' | 'session-live' | 'backend-unsupported'
  readonly message: string
}

/** Result shared by archive task mutations. */
export type SessionArchiveResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: SessionArchiveFailure }
