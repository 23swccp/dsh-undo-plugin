// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { MessageId } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConversationAdmissionFailureValue } from '@dsh-rollback/rollback-undo/types'
import { RollbackFold } from '../src/client/RollbackFold.tsx'
import { RollbackHeaderAction } from '../src/client/RollbackHeaderAction.tsx'
import type { ConversationUndoView } from '../src/client/controller.ts'

afterEach(cleanup)

const SESSION = 'session-a' as SessionId
const MESSAGE = 'message-a' as MessageId

function selector<T>(value: ConversationUndoView): (select: (snapshot: ConversationUndoView) => T) => T {
  return select => useSyncExternalStore(() => () => {}, () => select(value))
}

const stableSession: Record<string, { running: boolean }> = {}

function actionProps(running: boolean, view: ConversationUndoView, injected: {
  refresh: ReturnType<typeof vi.fn>
  checkAdmissionFailure: ReturnType<typeof vi.fn>
  undo: ReturnType<typeof vi.fn>
  setDraft: ReturnType<typeof vi.fn>
}): Parameters<typeof RollbackHeaderAction>[0] {
  const session = stableSession[String(running)] ??= { running }
  return {
    sessionId: SESSION,
    refresh: injected.refresh,
    checkAdmissionFailure: injected.checkAdmissionFailure,
    undo: injected.undo,
    inputActions: { setDraft: injected.setDraft },
    useSession: <T,>(select: (value: { running: boolean }) => T) =>
      useSyncExternalStore(() => () => {}, () => select(session)),
    useUndo: selector(view),
  } as unknown as Parameters<typeof RollbackHeaderAction>[0]
}

function injected() {
  return {
    refresh: vi.fn(),
    checkAdmissionFailure: vi.fn((): Promise<ConversationAdmissionFailureValue | undefined> => Promise.resolve(undefined)),
    undo: vi.fn(() => Promise.resolve()),
    setDraft: vi.fn(),
  }
}

function foldProps(running: boolean, view: ConversationUndoView, injected: {
  refresh: ReturnType<typeof vi.fn>
  revoke: ReturnType<typeof vi.fn>
}): Parameters<typeof RollbackFold>[0] {
  const session = stableSession[String(running)] ??= { running }
  return {
    sessionId: SESSION,
    refresh: injected.refresh,
    revoke: injected.revoke,
    useSession: <T,>(select: (value: { running: boolean }) => T) =>
      useSyncExternalStore(() => () => {}, () => select(session)),
    useUndo: selector(view),
  } as unknown as Parameters<typeof RollbackFold>[0]
}

describe('rollback fold', () => {
  it('renders the revoke card only while the Host retains the completed pair', async () => {
    const mocks = { refresh: vi.fn(), revoke: vi.fn(() => Promise.resolve()) }
    const ui = render(<RollbackFold {...foldProps(false, {
      status: 'ready',
      value: { sessionId: SESSION },
      revokePair: { sourceSessionId: 'session-source' as SessionId, prompt: 'remove me' },
      error: null,
    }, mocks)} />)

    await waitFor(() => { expect(mocks.refresh).toHaveBeenCalledTimes(1) })
    const group = ui.getByRole('group', { name: '可撤回的回滚' })
    expect(group.textContent).toContain('已回滚')
    expect(group.textContent).toContain('remove me')
    fireEvent.click(ui.getByRole('button', { name: '撤回回滚' }))
    await waitFor(() => { expect(mocks.revoke).toHaveBeenCalledTimes(1) })
  })

  it('hides the card when no revoke pair is retained', () => {
    render(<RollbackFold {...foldProps(false, {
      status: 'ready',
      value: { sessionId: SESSION },
      revokePair: undefined,
      error: null,
    }, { refresh: vi.fn(), revoke: vi.fn() })} />)

    expect(document.querySelector('[role="group"]')).toBeNull()
  })

  it('hides the card while the Session runs even with a retained pair', () => {
    render(<RollbackFold {...foldProps(true, {
      status: 'ready',
      value: { sessionId: SESSION },
      revokePair: { sourceSessionId: 'session-source' as SessionId, prompt: 'remove me' },
      error: null,
    }, { refresh: vi.fn(), revoke: vi.fn() })} />)

    expect(document.querySelector('[role="group"]')).toBeNull()
  })

  it('offers an expand toggle only for previews longer than 48 characters', async () => {
    const mocks = { refresh: vi.fn(), revoke: vi.fn(() => Promise.resolve()) }
    const long = 'x'.repeat(60)
    const ui = render(<RollbackFold {...foldProps(false, {
      status: 'ready',
      value: { sessionId: SESSION },
      revokePair: { sourceSessionId: 'session-source' as SessionId, prompt: long },
      error: null,
    }, mocks)} />)

    const summary = ui.getByRole('button', { name: /展开/ })
    expect(summary.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(summary)
    await waitFor(() => { expect(ui.getByRole('button', { name: /收起/ })).toBeTruthy() })
  })
})

describe('rollback header action', () => {
  it('renders the rollback action when the Host holds a rollback point', async () => {
    const mocks = injected()
    const ui = render(<RollbackHeaderAction {...actionProps(false, {
      status: 'ready',
      value: { sessionId: SESSION, messageId: MESSAGE, prompt: 'recover' },
      revokePair: undefined,
      error: null,
    }, mocks)} />)

    await waitFor(() => { expect(mocks.refresh).toHaveBeenCalledTimes(1) })
    const button = ui.getByRole('button', { name: '回滚到此消息之前' })
    expect(button.getAttribute('title')).toContain('恢复此消息发送前')
    fireEvent.click(button)
    await waitFor(() => { expect(mocks.undo).toHaveBeenCalledWith(MESSAGE) })
  })

  it('hides the action when no rollback point exists', () => {
    const mocks = injected()
    render(<RollbackHeaderAction {...actionProps(false, {
      status: 'ready',
      value: { sessionId: SESSION },
      revokePair: undefined,
      error: null,
    }, mocks)} />)

    expect(document.querySelector('button')).toBeNull()
  })

  it('restores a refused admission into the composer draft when the turn stops', async () => {
    const mocks = injected()
    const ui = render(<RollbackHeaderAction {...actionProps(true, {
      status: 'ready',
      value: { sessionId: SESSION, messageId: MESSAGE, prompt: 'recover' },
      revokePair: undefined,
      error: null,
    }, mocks)} />)
    mocks.checkAdmissionFailure.mockResolvedValue({ prompt: 'retry this', detail: '本地快照失败（snapshot-failed）。' })

    ui.rerender(<RollbackHeaderAction {...actionProps(false, {
      status: 'ready',
      value: { sessionId: SESSION, messageId: MESSAGE, prompt: 'recover' },
      revokePair: undefined,
      error: null,
    }, mocks)} />)

    await waitFor(() => {
      expect(mocks.setDraft).toHaveBeenCalledWith('retry this\n---------\n失败原因:\n本地快照失败（snapshot-failed）。')
    })
  })
})
