import { describe, expect, it, vi } from 'vitest'
import type { MessageId } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { ConversationUndoController } from '../src/client/controller.ts'
import type { ConversationUndoRemote } from '../src/client/controller.ts'
import { formatAdmissionFailureDraft } from '../src/client/RollbackHeaderAction.tsx'
import { previewLine } from '../src/client/RollbackFold.tsx'

const SESSION = 'session-a' as SessionId
const MESSAGE = 'message-a' as MessageId
const RESTORED = 'session-restored' as SessionId

function remote(overrides: Partial<ConversationUndoRemote> = {}): ConversationUndoRemote {
  const ready = {
    ok: true as const,
    value: {
      ok: true as const,
      value: { sessionId: SESSION, messageId: MESSAGE, prompt: 'restore this' },
    },
  }
  return {
    current: vi.fn(() => Promise.resolve(ready)),
    undoLatest: vi.fn(() => Promise.resolve(ready)),
    admissionFailure: vi.fn(() => Promise.resolve({ ok: true as const, value: undefined })),
    rollbackChild: vi.fn(() => Promise.resolve({ ok: true as const, value: undefined })),
    revokePair: vi.fn(() => Promise.resolve({ ok: true as const, value: undefined })),
    revoke: vi.fn(() => Promise.resolve({
      ok: true as const,
      value: { ok: true as const, value: { sessionId: RESTORED } },
    })),
    ...overrides,
  }
}

describe('ConversationUndoController', () => {
  it('keeps the rejected prompt and its safe snapshot detail in the replacement draft', () => {
    expect(formatAdmissionFailureDraft('retry this', '本地快照失败（snapshot-failed）。'))
      .toBe('retry this\n---------\n失败原因:\n本地快照失败（snapshot-failed）。')
  })

  it('reads the physical Session once and sends it to the rollback operation', async () => {
    const service = remote()
    const controller = new ConversationUndoController(service, SESSION)

    await Promise.all([controller.ensure(), controller.ensure()])
    await controller.undo(MESSAGE)

    expect(service.current).toHaveBeenCalledTimes(1)
    expect(service.current).toHaveBeenCalledWith({ sessionId: SESSION })
    expect(service.undoLatest).toHaveBeenCalledWith({ sessionId: SESSION, userMessageId: MESSAGE })
    expect(controller.getSnapshot()).toMatchObject({ status: 'ready', value: { messageId: MESSAGE } })
  })

  it('retains the prior view and surfaces a business refusal', async () => {
    const service = remote({
      undoLatest: vi.fn(() => Promise.resolve({
        ok: true as const,
        value: { ok: false as const, error: { code: 'session-busy' as const, message: 'wait for the turn' } },
      })),
    })
    const controller = new ConversationUndoController(service, SESSION)

    await controller.ensure()
    await expect(controller.undo(MESSAGE)).resolves.toBeUndefined()

    expect(controller.getSnapshot()).toMatchObject({
      status: 'error',
      value: { messageId: MESSAGE },
      error: 'wait for the turn',
    })
  })

  it('reads and clears a cached admission failure', async () => {
    const failure = { prompt: 'retry this', detail: '本地快照失败（snapshot-failed）。' }
    const service = remote({
      admissionFailure: vi.fn()
        .mockResolvedValueOnce({ ok: true as const, value: failure })
        .mockResolvedValue({ ok: true as const, value: undefined }),
    })
    const controller = new ConversationUndoController(service, SESSION)

    await expect(controller.admissionFailure()).resolves.toEqual(failure)
    await expect(controller.admissionFailure()).resolves.toBeUndefined()
  })

  it('keeps short prompts whole and truncates long ones with an ellipsis', () => {
    expect(previewLine('请只回复“ok”两个字。', 48)).toBe('请只回复“ok”两个字。')
    expect(previewLine('x'.repeat(60), 48)).toBe(`${'x'.repeat(48)}…`)
  })

  it('publishes the retained revoke pair alongside the rollback point', async () => {
    const service = remote({
      revokePair: vi.fn(() => Promise.resolve({
        ok: true as const,
        value: { sourceSessionId: 'session-source' as SessionId, prompt: 'remove me' },
      })),
    })
    const controller = new ConversationUndoController(service, SESSION)

    await controller.ensure()

    expect(service.revokePair).toHaveBeenCalledWith({ sessionId: SESSION })
    expect(controller.getSnapshot()).toMatchObject({
      status: 'ready',
      revokePair: { sourceSessionId: 'session-source', prompt: 'remove me' },
    })
  })

  it('revokes a completed rollback and clears the pair on success', async () => {
    const service = remote({
      revokePair: vi.fn(() => Promise.resolve({
        ok: true as const,
        value: { sourceSessionId: 'session-source' as SessionId, prompt: 'remove me' },
      })),
    })
    const controller = new ConversationUndoController(service, SESSION)

    await controller.ensure()
    await expect(controller.revoke()).resolves.toEqual({ sessionId: RESTORED })

    expect(service.revoke).toHaveBeenCalledWith({ sessionId: SESSION })
    expect(controller.getSnapshot()).toMatchObject({
      status: 'ready',
      value: { sessionId: SESSION },
      revokePair: undefined,
    })
  })

  it('retains the revoke pair and surfaces a revoke refusal', async () => {
    const service = remote({
      revokePair: vi.fn(() => Promise.resolve({
        ok: true as const,
        value: { sourceSessionId: 'session-source' as SessionId, prompt: 'remove me' },
      })),
      revoke: vi.fn(() => Promise.resolve({
        ok: true as const,
        value: { ok: false as const, error: { code: 'workspace-diverged' as const, message: '工作区已被修改' } },
      })),
    })
    const controller = new ConversationUndoController(service, SESSION)

    await controller.ensure()
    await expect(controller.revoke()).resolves.toBeUndefined()

    expect(controller.getSnapshot()).toMatchObject({
      status: 'error',
      revokePair: { sourceSessionId: 'session-source' },
      error: '工作区已被修改',
    })
  })
})
