import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { DefaultSessionForkService, SessionForkUnavailableError } from '../src/index.ts'

interface CutReader {
  beforeUserMessagePrefix(source: { id: SessionId; events: readonly SessionEvent[] }, messageId: MessageId): SessionEvent[]
}

function reader(): CutReader {
  return DefaultSessionForkService.prototype as unknown as CutReader
}

describe('Session fork before-user-message cut', () => {
  it('excludes the complete target turn from the child seed', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('session-fork-prefix'))
    const retained = createUserMessage({ content: [{ type: 'text', text: 'retain' }], source: { kind: 'user' } })
    const target = createUserMessage({ content: [{ type: 'text', text: 'remove' }], source: { kind: 'user' } })
    session.append('turn/start', { turn: 1 })
    session.append('user/message', retained, { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    session.append('turn/start', { turn: 2 })
    session.append('user/message', target, { surfaceOp: 'append' })
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })

    const prefix = reader().beforeUserMessagePrefix({ id: session.id, events: session.events }, target.id)

    expect(prefix).toEqual(session.events.slice(0, 3))
  })

  it('refuses a steer message even when its text would otherwise form a cut', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('session-fork-steer'))
    const steered = createUserMessage({
      content: [{ type: 'text', text: 'do not fork before a steer' }],
      source: { kind: 'user', delivery: 'steer' } as never,
    })
    session.append('turn/start', { turn: 1 })
    session.append('user/message', steered, { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    expect(() => reader().beforeUserMessagePrefix({ id: session.id, events: session.events }, steered.id))
      .toThrow(SessionForkUnavailableError)
  })
})
