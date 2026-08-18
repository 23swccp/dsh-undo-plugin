import { describe, expect, it, vi } from 'vitest'
import { ConversationUndoService } from '../src/index.ts'

interface ControlledActivityMethods {
  hasControlledActivity(agents: readonly unknown[]): boolean
  forceStopControlledActivity(agents: readonly unknown[]): Promise<void>
}

function methods(): ControlledActivityMethods {
  return ConversationUndoService.prototype as unknown as ControlledActivityMethods
}

describe('conversation-undo controlled activity', () => {
  it('recognizes and force-stops registered jobs and persistent terminals', async () => {
    const agent = { id: 'source-session' }
    const killJob = vi.fn()
    const killTerminal = vi.fn(async () => {})
    const jobs = {
      list: vi.fn(() => [{ id: 'job-1', status: 'running' }]),
      kill: killJob,
    }
    const terminals = {
      hasOwnerActivity: vi.fn(() => true),
      list: vi.fn(() => [{ sessionId: 'pty-1', status: { kind: 'running' } }]),
      kill: killTerminal,
    }
    const service = { ctx: { get: (name: string) => name === 'jobs' ? jobs : terminals } }

    expect(methods().hasControlledActivity.call(service, [agent])).toBe(true)
    await methods().forceStopControlledActivity.call(service, [agent])

    expect(killJob).toHaveBeenCalledWith('job-1', agent, 'rollback quiescence')
    expect(killTerminal).toHaveBeenCalledWith(agent, 'pty-1', 'rollback quiescence')
  })

  it('does not invent activity when neither optional provider is loaded', () => {
    const service = { ctx: { get: () => undefined } }

    expect(methods().hasControlledActivity.call(service, [{ id: 'source-session' }])).toBe(false)
  })
})
