/**
 * Session archive capability (standalone plugin): the one owner of archive
 * listing, read-only viewing, and tombstone hiding. Restoration and permanent
 * deletion are intentionally absent — dsh publishes no unarchive or
 * delete/removeImage API, so this plugin degrades those original-spec
 * operations to a plugin-owned tombstone list.
 * @module @dsh-rollback/rollback-archive
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { foldSessionTitle } from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-session-title'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@dsh-rollback/rollback-fork'
import type {
  ArchivedSessionItem,
  ArchivedSessionReadValue,
  SessionArchiveDeleteAllValue,
  SessionArchiveDeleteFailure,
  SessionArchiveListValue,
  SessionArchiveMutationValue,
  SessionArchiveResult,
  SessionArchiveSessionRequest,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Provider-owned archive lifecycle capability. */
    sessionArchive: SessionArchiveService
  }
}

/** Service Definition for the Host-global Session archive collection. */
export interface SessionArchiveService {
  /** Add one durable Session to the global archive set.
   * @param sessionId - Durable Session to hide globally.
   * @returns Resolution after archive membership is durable.
   */
  archive(sessionId: SessionId): Promise<void>
  /** Hide one archived Session from the archive task list without touching its log.
   * @param sessionId - Archived Session to tombstone.
   * @returns Mutation result; absent memberships resolve without writing.
   */
  tombstone(sessionId: SessionId): Promise<SessionArchiveResult<SessionArchiveMutationValue>>
  /** Reveal one tombstoned Session in the archive task list again.
   * @param sessionId - Tombstoned Session to reveal.
   * @returns Mutation result; absent tombstones resolve without writing.
   */
  untombstone(sessionId: SessionId): Promise<SessionArchiveResult<SessionArchiveMutationValue>>
  /** Whether one Session is currently tombstoned by this plugin.
   * @param sessionId - Session to test.
   * @returns Whether the Session is hidden from the archive task list.
   */
  isTombstoned(sessionId: SessionId): boolean
}

/** Deployment-owned directory for durable archive metadata. */
export interface Config {
  /** Absolute application-data root owned exclusively by this plugin. */
  readonly root: string
}

/** Host Provider for the global archive set and the plugin-owned tombstone list. */
export class DefaultSessionArchiveService extends TypertRemoteService implements SessionArchiveService {
  static inject = ['agents', 'sessionPersistence', 'sessions', 'sessionFork', 'workspaceRegistry']
  static Config: s<Config> = s.object({ root: s.string().min(1).required() })

  private readonly archiveTimes = new Map<SessionId, number>()
  private readonly archiveTimesPath: string
  private readonly tombstones = new Set<SessionId>()
  private readonly tombstonesPath: string

  constructor(ctx: Context, config: Config) {
    super(ctx, 'sessionArchive')
    this.archiveTimesPath = join(resolve(config.root), 'archive-times.json')
    this.tombstonesPath = join(resolve(config.root), 'tombstones.json')
  }

  /** Load archive timestamps and tombstones before serving the archive collection. */
  protected async [Service.init](): Promise<void> {
    await mkdir(dirname(this.archiveTimesPath), { recursive: true })
    await this.loadDocument(this.archiveTimesPath, (parsed: unknown) => {
      if (!isArchiveTimesFile(parsed)) throw new Error('rollback archive: archive timestamp file is invalid')
      for (const [id, archivedAt] of Object.entries(parsed.archivedAt)) this.archiveTimes.set(id as SessionId, archivedAt)
    })
    await this.loadDocument(this.tombstonesPath, (parsed: unknown) => {
      if (!isTombstonesFile(parsed)) throw new Error('rollback archive: tombstone file is invalid')
      for (const id of parsed.sessionIds) this.tombstones.add(id as SessionId)
    })
  }

  /** Add one Session to the Host archive set. */
  async archive(sessionId: SessionId): Promise<void> {
    if (this.ctx.workspaceRegistry.archivedSessionIds.includes(sessionId)) return
    const prior = this.archiveTimes.get(sessionId)
    await this.setArchiveTime(sessionId, Date.now())
    try {
      await this.ctx.workspaceRegistry.archiveSession(sessionId)
    } catch (error) {
      try {
        await this.setArchiveTime(sessionId, prior)
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], `rollback archive could not restore timestamp for "${sessionId}" after archiving failed`)
      }
      throw error
    }
  }

  /** Hide one archived Session from the archive task list without touching its log. */
  @Remote('tombstone')
  async tombstone(sessionId: SessionId): Promise<SessionArchiveResult<SessionArchiveMutationValue>> {
    if (!this.ctx.workspaceRegistry.archivedSessionIds.includes(sessionId)) {
      return this.failure('not-archived', `session "${sessionId}" is not archived`)
    }
    if (!this.tombstones.has(sessionId)) {
      this.tombstones.add(sessionId)
      await this.writeTombstones()
    }
    return this.success({ changed: true })
  }

  /** Reveal one tombstoned Session in the archive task list again. */
  @Remote('untombstone')
  async untombstone(sessionId: SessionId): Promise<SessionArchiveResult<SessionArchiveMutationValue>> {
    if (this.tombstones.delete(sessionId)) await this.writeTombstones()
    return this.success({ changed: true })
  }

  /** Restore one archived conversation as a new visible Session without touching its log.
   * @param request - Archived Session to restore.
   * @returns The replacement Session or a business refusal.
   */
  @Remote('restore')
  async restore(request: SessionArchiveSessionRequest): Promise<SessionArchiveResult<SessionArchiveMutationValue>> {
    if (!this.ctx.workspaceRegistry.archivedSessionIds.includes(request.sessionId)) {
      return this.failure('not-archived', `session "${request.sessionId}" is not archived`)
    }
    try {
      const restored = await this.ctx.sessionFork.fork({
        sourceSessionId: request.sessionId,
        cut: { kind: 'completed-turn' },
      })
      return this.success({ changed: true, sessionId: restored.handle.agent.id })
    } catch (error) {
      return this.failure('session-live', `session "${request.sessionId}" could not be restored: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** Permanently delete an archived Session's log files and hide it from the task list.
   * @param request - Archived Session to erase.
   * @returns Permanent-deletion mutation result.
   */
  @Remote('delete')
  async delete(request: SessionArchiveSessionRequest): Promise<SessionArchiveResult<SessionArchiveMutationValue>> {
    if (!this.ctx.workspaceRegistry.archivedSessionIds.includes(request.sessionId)) {
      return this.failure('not-archived', `session "${request.sessionId}" is not archived`)
    }
    const agent = this.ctx.agents.get(request.sessionId)
    let status: Agent['status'] = agent?.status ?? 'idle'
    if (status !== 'idle') {
      agent?.cancel({ kind: 'user' })
      const deadline = Date.now() + 2000
      while (status !== 'idle' && Date.now() < deadline) {
        await new Promise<void>(resolve => { setTimeout(resolve, 50) })
        status = this.ctx.agents.get(request.sessionId)?.status ?? 'idle'
      }
      if (status !== 'idle') {
        return this.failure('session-live', `session "${request.sessionId}" is still running and cannot be permanently deleted`)
      }
    }
    const header = (await this.headers()).get(request.sessionId)
    const location = header === undefined ? undefined : this.ctx.sessionPersistence.locate(header)
    if (location === undefined) {
      return this.failure('backend-unsupported', 'this session backend does not expose a deletable artifact')
    }
    try {
      await rm(dirname(location.path), { recursive: true, force: true })
    } catch (error) {
      return this.failure('backend-unsupported', `session "${request.sessionId}" log deletion failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    await this.setArchiveTime(request.sessionId, undefined)
    await this.tombstone(request.sessionId)
    return this.success({ changed: true })
  }

  /** Permanently delete every non-tombstoned archived Session.
   * @returns Per-Session outcomes; individual refusals do not stop the sweep.
   */
  @Remote('deleteAll')
  async deleteAll(): Promise<SessionArchiveDeleteAllValue> {
    const deleted: SessionId[] = []
    const failed: SessionArchiveDeleteFailure[] = []
    for (const sessionId of this.ctx.workspaceRegistry.archivedSessionIds) {
      if (this.tombstones.has(sessionId)) continue
      const result = await this.delete({ sessionId })
      if (result.ok) deleted.push(sessionId)
      else failed.push({ sessionId, message: result.error.message })
    }
    return { deleted, failed }
  }

  /** Whether one Session is currently hidden from the archive task list. */
  isTombstoned(sessionId: SessionId): boolean {
    return this.tombstones.has(sessionId)
  }

  /** List the Host archive set with persisted metadata for the archive task UI.
   * @returns Archive metadata for every currently archived, non-tombstoned Session.
   */
  @Remote('list')
  async list(): Promise<SessionArchiveListValue> {
    const headers = await this.headers()
    const items: ArchivedSessionItem[] = []
    for (const sessionId of this.ctx.workspaceRegistry.archivedSessionIds) {
      if (this.tombstones.has(sessionId)) continue
      const header = headers.get(sessionId)
      if (header === undefined) continue
      const events = await this.events(sessionId)
      const title = titleOf(events)
      items.push({
        sessionId,
        ...title === undefined ? {} : { title },
        archivedAt: this.archiveTimes.get(sessionId) ?? header.createdAt,
        createdAt: header.createdAt,
        ...header.cwd === undefined ? {} : { cwd: header.cwd },
      })
    }
    return { items }
  }

  /** Read one archived Session without making it visible to ordinary navigation.
   * @param request - Archived Session to read.
   * @returns Text transcript and metadata without navigation changes.
   */
  @Remote('read')
  async read(request: SessionArchiveSessionRequest): Promise<SessionArchiveResult<ArchivedSessionReadValue>> {
    if (!this.ctx.workspaceRegistry.archivedSessionIds.includes(request.sessionId)) {
      return this.failure('not-archived', `session "${request.sessionId}" is not archived`)
    }
    const events = await this.events(request.sessionId)
    const title = titleOf(events)
    return this.success({
      sessionId: request.sessionId,
      ...title === undefined ? {} : { title },
      messages: transcript(events),
    })
  }

  /** Combine persisted and live headers; live identities win over a stale durable listing. */
  private async headers(): Promise<Map<SessionId, SessionHeader>> {
    const headers = new Map((await this.ctx.sessionPersistence.list()).map(header => [header.id, header]))
    for (const session of this.ctx.sessions.list()) headers.set(session.id, session.header)
    return headers
  }

  /** Read the authoritative event list regardless of whether the Session is currently loaded. */
  private async events(sessionId: SessionId): Promise<readonly SessionEvent[]> {
    return this.ctx.sessions.get(sessionId)?.events ?? (await this.ctx.sessionPersistence.inspect(sessionId)).events
  }

  /** Change one timestamp and persist the complete plugin-owned document. */
  private async setArchiveTime(sessionId: SessionId, archivedAt: number | undefined): Promise<void> {
    const prior = this.archiveTimes.get(sessionId)
    if (archivedAt === undefined) this.archiveTimes.delete(sessionId)
    else this.archiveTimes.set(sessionId, archivedAt)
    try {
      await this.writeDocument(this.archiveTimesPath, { version: 1, archivedAt: Object.fromEntries(this.archiveTimes) })
    } catch (error) {
      if (prior === undefined) this.archiveTimes.delete(sessionId)
      else this.archiveTimes.set(sessionId, prior)
      throw error
    }
  }

  /** Persist the complete tombstone document. */
  private async writeTombstones(): Promise<void> {
    await this.writeDocument(this.tombstonesPath, { version: 1, sessionIds: [...this.tombstones] })
  }

  /** Load one optional plugin-owned document. */
  private async loadDocument(path: string, accept: (parsed: unknown) => void): Promise<void> {
    try {
      accept(JSON.parse(await readFile(path, 'utf8')))
    } catch (error) {
      if (!isENOENT(error)) throw error
    }
  }

  /** Atomically replace one plugin-owned JSON document. */
  private async writeDocument(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  }

  /** Make one immutable success result. */
  private success<T>(value: T): SessionArchiveResult<T> {
    return { ok: true, value }
  }

  /** Make one expected archive-task refusal. */
  private failure<T>(code: 'not-archived' | 'session-live' | 'backend-unsupported', message: string): SessionArchiveResult<T> {
    return { ok: false, error: { code, message } }
  }
}

/** Find a persisted title without consulting live title-service state. */
function titleOf(events: readonly SessionEvent[]): string | undefined {
  return foldSessionTitle(events)?.title
}

/** Preserve ordinary text exchange for the archive viewer; tool payloads remain outside this presentation. */
function transcript(events: readonly SessionEvent[]): ArchivedSessionReadValue['messages'] {
  const messages: ArchivedSessionReadValue['messages'][number][] = []
  for (const event of events) {
    switch (event.type) {
      case 'user/message': {
        const text = textContent(event.data.content)
        if (text.length > 0) messages.push({ role: 'user', text })
        break
      }
      case 'assistant/message': {
        const text = textContent(event.data.message.content)
        if (text.length > 0) messages.push({ role: 'assistant', text })
        break
      }
      default:
        break
    }
  }
  return messages
}

/** Join direct text content without exposing attachments or tool-result payloads in the archive viewer. */
function textContent(content: readonly ContentBlock[]): string {
  return content.filter(block => block.type === 'text').map(block => block.text).join('')
}

/** Validate the small plugin-owned timestamp document before mutating archive membership. */
function isArchiveTimesFile(value: unknown): value is { readonly version: 1; readonly archivedAt: Record<string, number> } {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as { version?: unknown; archivedAt?: unknown }
  if (candidate.version !== 1 || candidate.archivedAt === null || typeof candidate.archivedAt !== 'object') return false
  return Object.values(candidate.archivedAt).every(timestamp => typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp >= 0)
}

/** Validate the small plugin-owned tombstone document. */
function isTombstonesFile(value: unknown): value is { readonly version: 1; readonly sessionIds: string[] } {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as { version?: unknown; sessionIds?: unknown }
  if (candidate.version !== 1 || !Array.isArray(candidate.sessionIds)) return false
  return candidate.sessionIds.every(id => typeof id === 'string' && id.length > 0)
}

/** Identify an absent optional metadata document without swallowing other I/O failures. */
function isENOENT(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

export default DefaultSessionArchiveService
