/**
 * Session fork capability: construct an Agent from an exact, completed Session prefix (standalone rollback plugin fork).
 * @module @dsh-undo/rollback-fork
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, AgentOptions } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionEvent, SessionHeader, SessionId, UserMessage } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-query'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-workspace'

/** The explicit source boundary requested for one child Session. */
export type SessionForkCut =
  /** Keep a complete turn and any following between-turn events. */
  | { readonly kind: 'completed-turn'; readonly atSeq?: number }
  /** Exclude the target user's complete turn, including its injected context. */
  | { readonly kind: 'before-user-message'; readonly messageId: MessageId }

/** One request to fork a source Session into a newly created Agent. */
export interface SessionForkRequest {
  /** Live or persisted source Session identity. */
  readonly sourceSessionId: SessionId
  /** Exact boundary to retain in the child Session seed. */
  readonly cut: SessionForkCut
  /** Caller-selected child identity; omitted uses a generated Session id. */
  readonly childSessionId?: SessionId
  /** Source options retained before a caller deliberately quiesces a live Agent. */
  readonly retainedAgentOptions?: AgentOptions
}

/** One forked Agent and the exact retained source prefix. */
export interface SessionForkResult {
  /** Capability that owns and can dispose the new Agent. */
  readonly handle: AgentHandle
  /** Session events supplied to the child as its immutable seed. */
  readonly seed: readonly SessionEvent[]
}

/** A request could not produce a valid child prefix. */
export class SessionForkUnavailableError extends Error {
  /** Stable machine-readable refusal code. */
  readonly code = 'fork-unavailable'

  /** @param message - Stable human-readable refusal. */
  constructor(message: string) {
    super(message)
    this.name = 'SessionForkUnavailableError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Provider-owned Session fork capability. */
    sessionFork: SessionForkService
  }
}

/** Service Definition for exact Session branches. */
export abstract class SessionForkService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'sessionFork')
  }

  /**
   * Create one child Agent from a completed source prefix and attach it to the source Workspace.
   * @param request - Source identity, explicit cut, and optional child id.
   * @returns an owned child Agent handle and retained prefix.
   * @throws {@link SessionForkUnavailableError} when the requested cut is invalid or incomplete.
   */
  abstract fork(request: SessionForkRequest): Promise<SessionForkResult>
}

type Source = {
  readonly id: SessionId
  readonly header: SessionHeader
  readonly events: readonly SessionEvent[]
  readonly agent?: Agent
}

/** A Host Provider that owns fork Agent creation, composition, and Workspace attachment. */
export class DefaultSessionForkService extends SessionForkService {
  static inject = ['agents', 'sessions', 'sessionPersistence', 'workspaceRegistry', 'agentDefaultModel']

  /** Resolve, cut, create, and attach one child transactionally. */
  async fork(request: SessionForkRequest): Promise<SessionForkResult> {
    const source = await this.readSource(request.sourceSessionId)
    const seed = this.cut(source, request.cut)
    const workspace = await this.workspaceFor(source)
    const childSessionId = request.childSessionId ?? `session-${randomUUID()}` as SessionId
    const presetId = resolveSessionPreset({ header: source.header, events: source.events })
    const composition = await this.compose(presetId)
    const handle = await this.ctx.agents.create({
      sessionId: childSessionId,
      seed,
      meta: {
        ...source.header.cwd === undefined ? {} : { cwd: source.header.cwd },
        parentSession: source.id,
        seedLength: seed.length,
        ...composition.agentPreset === undefined ? {} : { agentPreset: composition.agentPreset },
      },
      agentOptions: source.agent?.options ?? request.retainedAgentOptions ?? this.defaultOptions(),
      setup: composition.setup,
    })
    try {
      if (workspace !== undefined) await workspace.attachSession(handle.agent.id)
    } catch (error) {
      try {
        await handle.dispose()
      } catch (disposeError) {
        throw new AggregateError([error, disposeError], `session fork "${source.id}" could not attach or dispose its child`)
      }
      throw error
    }
    return { handle, seed }
  }

  /** Resolve a live Session first, then an immutable persisted inspection. */
  private async readSource(id: SessionId): Promise<Source> {
    const live = this.ctx.sessions.get(id)
    if (live !== undefined) {
      const agent = this.ctx.agents.get(id)
      return {
        id: live.id,
        header: live.header,
        events: live.events,
        ...agent === undefined ? {} : { agent },
      }
    }
    const stored = await this.ctx.sessionPersistence.inspect(id)
    return { id: stored.meta.id, header: stored.meta, events: stored.events }
  }

  /** Select the exact balanced prefix requested by the caller. */
  private cut(source: Source, cut: SessionForkCut): SessionEvent[] {
    switch (cut.kind) {
      case 'completed-turn':
        return this.completedTurnPrefix(source, cut.atSeq)
      case 'before-user-message':
        return this.beforeUserMessagePrefix(source, cut.messageId)
      default:
        return assertNever(cut)
    }
  }

  /** Keep the requested completed turn, matching the former session.fork behavior. */
  private completedTurnPrefix(source: Source, atSeq: number | undefined): SessionEvent[] {
    const events = source.events
    const lastSeq = events.at(-1)?.seq ?? -1
    const boundary = atSeq === undefined
      ? events.findLast(event => event.type === 'turn/end')
      : events.find(event => event.type === 'turn/end' && event.seq >= atSeq)
        ?? (atSeq > lastSeq ? events.findLast(event => event.type === 'turn/end') : undefined)
    if (boundary === undefined) {
      throw new SessionForkUnavailableError(
        atSeq !== undefined && atSeq <= lastSeq
          ? `session "${source.id}" has not completed the turn containing event ${String(atSeq)}`
          : `session "${source.id}" has no completed turn to fork from`,
      )
    }
    let cut = boundary.seq + 1
    while (cut < events.length && events[cut]?.type !== 'turn/start') cut += 1
    return events.slice(0, cut)
  }

  /** Exclude the complete turn that owns the target ordinary user message. */
  private beforeUserMessagePrefix(source: Source, messageId: MessageId): SessionEvent[] {
    const targetIndex = source.events.findIndex(event =>
      event.type === 'user/message' && event.data.id === messageId && isOrdinaryUserMessage(event.data))
    if (targetIndex < 0) {
      throw new SessionForkUnavailableError(`session "${source.id}" has no eligible user message "${messageId}"`)
    }
    const target = source.events[targetIndex] as Extract<SessionEvent, { type: 'user/message' }>
    let startIndex = -1
    for (let index = targetIndex - 1; index >= 0; index -= 1) {
      const event = source.events[index]
      if (event?.type !== 'turn/start') continue
      startIndex = index
      break
    }
    if (startIndex < 0) throw new SessionForkUnavailableError(`user message "${messageId}" has no owning turn`)
    const start = source.events[startIndex] as Extract<SessionEvent, { type: 'turn/start' }>
    const end = source.events.slice(targetIndex + 1).find(event =>
      event.type === 'turn/end' && event.data.turn === start.data.turn)
    if (end === undefined) {
      throw new SessionForkUnavailableError(`user message "${messageId}" belongs to an unfinished turn`)
    }
    if (target.seq <= start.seq) throw new SessionForkUnavailableError(`user message "${messageId}" has an invalid turn boundary`)
    const prefix = source.events.slice(0, startIndex)
    if (!isCompletedPrefix(prefix)) {
      throw new SessionForkUnavailableError(`user message "${messageId}" does not follow a complete Session prefix`)
    }
    return prefix
  }

  /** Resolve direct Workspace membership, then a subagent ancestor's membership. */
  private async workspaceFor(source: Pick<Source, 'id' | 'header'>): Promise<Workspace | undefined> {
    const workspaces = this.ctx.workspaceRegistry.list()
    const direct = workspaces.find(workspace => workspace.sessionIds.includes(source.id))
    if (direct !== undefined || source.header.origin !== 'subagent') return direct
    const lineage = await this.ctx.get('sessionQuery')?.traceSession(source.id)
    for (const ancestor of lineage?.ancestors ?? []) {
      const workspace = workspaces.find(candidate => candidate.sessionIds.includes(ancestor.header.id))
      if (workspace !== undefined) return workspace
    }
    return undefined
  }

  /** Resolve the source composition before the child Session header is snapshotted. */
  private async compose(presetId: string | undefined): Promise<{
    readonly agentPreset?: string
    readonly setup: (agentCtx: Context) => Promise<void>
  }> {
    const presets = this.ctx.get('agentPresets')
    if (presets === undefined) return { setup: () => Promise.resolve() }
    const preset = await presets.resolve(presetId)
    return {
      agentPreset: preset.id,
      setup: async (agentCtx) => { await presets.mount(agentCtx, preset.id) },
    }
  }

  /** Read the Host default only for a cold source that has no live Agent options. */
  private defaultOptions(): AgentOptions {
    return this.ctx.agentDefaultModel.currentSelection()
  }
}

/** True when a message is a direct, text-only human submission. */
function isOrdinaryUserMessage(message: UserMessage): boolean {
  return message.source.kind === 'user'
    && !('delivery' in message.source && message.source.delivery === 'steer')
    && message.content.every(block => block.type === 'text')
}

/** The prefix must not retain an unfinished turn. */
function isCompletedPrefix(events: readonly SessionEvent[]): boolean {
  let open: number | undefined
  for (const event of events) {
    if (event.type === 'turn/start') {
      if (open !== undefined) return false
      open = event.data.turn
    } else if (event.type === 'turn/end') {
      if (open !== event.data.turn) return false
      open = undefined
    }
  }
  return open === undefined
}

/** Require exhaustive handling when SessionForkCut gains a member. */
function assertNever(value: never): never {
  throw new Error(`unhandled Session fork cut: ${JSON.stringify(value)}`)
}

export default DefaultSessionForkService
