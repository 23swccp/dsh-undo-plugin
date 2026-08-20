// @vitest-environment jsdom
/** Message-actions rollback button patch behavior (jsdom). */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { mountMessageActionsPatch } from '../src/client/messageActionsPatch.ts'

/** One user flow item shaped like rc.7's chat flow output. */
function userFlowItem(messageId: string): { flowItem: HTMLElement; actionsRow: HTMLElement } {
  const flowItem = document.createElement('div')
  flowItem.setAttribute('data-chat-flow-kind', 'user')
  flowItem.setAttribute('data-chat-flow-key', `13:input-message${messageId}`)
  const seat = document.createElement('div')
  seat.setAttribute('data-slot', 'conversation.chat.node')
  seat.style.display = 'contents'
  const userRow = document.createElement('div')
  userRow.setAttribute('data-time-hover-root', 'true')
  const userStack = document.createElement('div')
  userStack.textContent = 'message body'
  const actionsRow = document.createElement('div')
  const copy = document.createElement('button')
  copy.setAttribute('aria-label', '复制')
  actionsRow.append(copy)
  userRow.append(userStack, actionsRow)
  seat.append(userRow)
  flowItem.append(seat)
  document.body.append(flowItem)
  return { flowItem, actionsRow }
}

/** Minimal observable stores driving the patch. */
function makeStores(current: string | undefined, messageId: string | undefined, running = false) {
  const listeners = new Set<() => void>()
  const controllerListeners = new Set<() => void>()
  const listState = { current, byId: current === undefined ? {} : { [current]: { running } } }
  const view = {
    status: 'ready' as const,
    value: messageId === undefined ? undefined : { messageId, sessionId: current ?? '' },
    revokePair: undefined,
    error: null,
  } as unknown as import('../src/client/controller.ts').ConversationUndoView
  const undo = vi.fn(async () => {})
  const patch = mountMessageActionsPatch({
    list: {
      getSnapshot: () => listState as unknown as { current: import('@deepseek-ai/dsh-client-runtime/client').SessionId | undefined; byId: Readonly<Record<string, { running: boolean }>> },
      subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn) } },
    },
    controllerFor: () => ({
      getSnapshot: () => view,
      subscribe: fn => { controllerListeners.add(fn); return () => { controllerListeners.delete(fn) } },
    }),
    undo: undo as unknown as (sessionId: import('@deepseek-ai/dsh-client-runtime/client').SessionId, messageId: import('@deepseek-ai/dsh-client-connection/client').MessageId) => Promise<void>,
  })
  return {
    patch,
    undo,
    notifyList: () => { for (const fn of [...listeners]) fn() },
    notifyController: () => { for (const fn of [...controllerListeners]) fn() },
    setPoint: (id: string | undefined) => { (view as { value: unknown }).value = id === undefined ? undefined : { messageId: id, sessionId: current ?? '' } },
    setRunning: (value: boolean) => { if (current !== undefined) listState.byId[current] = { running: value } },
  }
}

const BUTTON = '[data-dsh-rollback-message-action]'

describe('mountMessageActionsPatch', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('adds one button to the qualified user message only, after Copy', () => {
    const target = userFlowItem('aaaaaaaa-0000-0000-0000-000000000001')
    const other = userFlowItem('bbbbbbbb-0000-0000-0000-000000000002')
    const stores = makeStores('session-1', 'aaaaaaaa-0000-0000-0000-000000000001')
    const buttons = document.querySelectorAll(BUTTON)
    expect(buttons).toHaveLength(1)
    const button = buttons[0] as HTMLButtonElement
    expect(target.actionsRow.contains(button)).toBe(true)
    expect(button.previousElementSibling?.getAttribute('aria-label')).toBe('复制')
    expect(other.actionsRow.querySelector(BUTTON)).toBeNull()
    expect(button.querySelector('svg')).not.toBeNull()
    expect(button.getAttribute('aria-label')).toBe('回滚到此消息之前')
    expect(button.disabled).toBe(false)
    stores.patch()
  })

  it('shows no button when the session has no rollback point', () => {
    userFlowItem('aaaaaaaa-0000-0000-0000-000000000001')
    const stores = makeStores('session-1', undefined)
    expect(document.querySelector(BUTTON)).toBeNull()
    stores.patch()
  })

  it('disables while the session runs', () => {
    userFlowItem('aaaaaaaa-0000-0000-0000-000000000001')
    const stores = makeStores('session-1', 'aaaaaaaa-0000-0000-0000-000000000001', true)
    const button = document.querySelector(BUTTON) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    stores.setRunning(false)
    stores.notifyList()
    expect(button.disabled).toBe(false)
    stores.patch()
  })

  it('moves the button when a newer message is armed', () => {
    const first = userFlowItem('aaaaaaaa-0000-0000-0000-000000000001')
    const second = userFlowItem('bbbbbbbb-0000-0000-0000-000000000002')
    const stores = makeStores('session-1', 'aaaaaaaa-0000-0000-0000-000000000001')
    expect(first.actionsRow.querySelector(BUTTON)).not.toBeNull()
    stores.setPoint('bbbbbbbb-0000-0000-0000-000000000002')
    stores.notifyController()
    expect(first.actionsRow.querySelector(BUTTON)).toBeNull()
    expect(second.actionsRow.querySelector(BUTTON)).not.toBeNull()
    stores.patch()
  })

  it('clicks invoke undo with the session and the armed message', async () => {
    userFlowItem('aaaaaaaa-0000-0000-0000-000000000001')
    const stores = makeStores('session-1', 'aaaaaaaa-0000-0000-0000-000000000001')
    const button = document.querySelector(BUTTON) as HTMLButtonElement
    button.click()
    await vi.waitFor(() => { expect(stores.undo).toHaveBeenCalledWith('session-1', 'aaaaaaaa-0000-0000-0000-000000000001') })
    stores.patch()
  })

  it('re-inserts after the flow item remounts (observer heals)', async () => {
    const { flowItem } = userFlowItem('aaaaaaaa-0000-0000-0000-000000000001')
    const stores = makeStores('session-1', 'aaaaaaaa-0000-0000-0000-000000000001')
    expect(document.querySelector(BUTTON)).not.toBeNull()
    flowItem.remove()
    document.body.append(flowItem)
    await vi.waitFor(() => { expect(document.querySelector(BUTTON)).not.toBeNull() })
    stores.patch()
  })

  it('removes every button on dispose', () => {
    userFlowItem('aaaaaaaa-0000-0000-0000-000000000001')
    const stores = makeStores('session-1', 'aaaaaaaa-0000-0000-0000-000000000001')
    expect(document.querySelector(BUTTON)).not.toBeNull()
    stores.patch()
    expect(document.querySelector(BUTTON)).toBeNull()
  })

  it('renders the composer enter-key glyph verbatim (viewBox, size, path, fill)', () => {
    userFlowItem('aaaaaaaa-0000-0000-0000-000000000001')
    const stores = makeStores('session-1', 'aaaaaaaa-0000-0000-0000-000000000001')
    const svg = document.querySelector(`${BUTTON} svg`) as SVGSVGElement
    const path = svg.querySelector('path') as SVGPathElement
    expect(svg.getAttribute('viewBox')).toBe('0 0 16 16')
    expect(svg.getAttribute('width')).toBe('16')
    expect(svg.getAttribute('height')).toBe('16')
    expect(path.getAttribute('d')).toBe('M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z')
    expect(path.getAttribute('fill')).toBe('currentColor')
    stores.patch()
  })
})
