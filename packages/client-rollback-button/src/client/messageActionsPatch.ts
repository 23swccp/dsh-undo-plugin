/**
 * Message-actions rollback button for the dsh web conversation (main-tree
 * parity): one icon button in the qualified user message's actions row, right
 * after Copy, carrying the composer's enter-key glyph verbatim.
 *
 * rc.7 has no user-message actions slot (only the turn-tail assistant-actions
 * strip), so this is the navIconPatch pattern applied to the chat flow:
 *
 *   - rc.7's chat flow publishes one stable contract per node —
 *     `[data-chat-flow-kind]` plus a `data-chat-flow-key` whose
 *     `input-message<uuid>` tail IS the durable message id (verified against
 *     the rollback journal's messageId). The armed rollback point therefore
 *     matches exactly one user row: `key.endsWith(messageId)`.
 *   - The button is a FOREIGN node React never reconciles; a MutationObserver
 *     re-inserts after any remount the diff discards (virtualization, session
 *     switch), and subscriptions (sessions list + controller view) drive the
 *     same idempotent rescan.
 *   - The icon is the composer send key's own inline SVG path (ui-conversation
 *     carries a private copy whose coordinates differ from the primitives
 *     export in the third decimal), inlined verbatim so the glyph the user
 *     sees is byte-identical to the enter key.
 */

import type { MessageId } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConversationUndoView } from './controller.ts'
import css from './messageActions.module.css'

/** Marker attribute on the foreign button (kebab-case literal: the selector
 * must match the attribute exactly; a dataset write would mangle camelCase). */
const MARK = 'data-dsh-rollback-message-action'

/** The composer send key's inline glyph (dsh-client-ui-conversation InputBar),
 * copied verbatim so the message-action button matches the enter key exactly. */
const ENTER_KEY_ICON_PATH = 'M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z'

/** Minimal list-store face this patch consumes (structural, like WorkspacesPort). */
export interface SessionsListPort {
  getSnapshot(): { readonly current: SessionId | undefined; readonly byId: Readonly<Record<string, { readonly running: boolean }>> }
  subscribe(fn: () => void): () => void
}

/** Minimal controller face this patch consumes. */
export interface UndoControllerPort {
  getSnapshot(): ConversationUndoView
  subscribe(fn: () => void): () => void
}

/** Wiring the patch needs from the owning apply. */
export interface MessageActionsPatchDeps {
  /** Sessions list store: current selection plus per-row running state. */
  readonly list: SessionsListPort
  /** Per-session controller lookup (the shared rollback-point view). */
  readonly controllerFor: (sessionId: SessionId) => UndoControllerPort
  /** Roll back one message: undo and open the replacement session. */
  readonly undo: (sessionId: SessionId, messageId: MessageId) => Promise<void>
}

/** The enter-key glyph as a fresh svg element (cloned per button). */
function buildEnterKeyIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', ENTER_KEY_ICON_PATH)
  path.setAttribute('fill', 'currentColor')
  svg.append(path)
  return svg
}

/** The user row's actions container: the child of the hover root that holds buttons. */
function findActionsRow(flowItem: HTMLElement): HTMLElement | null {
  const hoverRoot = flowItem.querySelector('[data-time-hover-root]')
  if (!(hoverRoot instanceof HTMLElement)) return null
  for (const child of hoverRoot.children) {
    if (child.querySelector('button') !== null && child instanceof HTMLElement) return child
  }
  return null
}

/**
 * Mount the message-actions rollback button for the lifetime of the plugin.
 * @param deps - list store, controller lookup, and the undo verb.
 * @returns Disposer removing the observer, subscriptions, and every button.
 */
export function mountMessageActionsPatch(deps: MessageActionsPatchDeps): () => void {
  const icon = buildEnterKeyIcon()
  let pending = false
  const owned = new Set<HTMLElement>()

  const removeButton = (button: HTMLElement): void => {
    button.remove()
    owned.delete(button)
  }

  const scan = (): void => {
    const snapshot = deps.list.getSnapshot()
    const current = snapshot.current
    const view = current === undefined ? undefined : deps.controllerFor(current).getSnapshot()
    const messageId = view?.value?.messageId
    const running = current === undefined ? false : snapshot.byId[current]?.running === true
    const disabled = pending || running
    for (const flowItem of [...document.querySelectorAll<HTMLElement>('[data-chat-flow-kind="user"]')]) {
      const key = flowItem.getAttribute('data-chat-flow-key') ?? ''
      const qualified = messageId !== undefined && key.endsWith(messageId)
      const existing = flowItem.querySelector<HTMLButtonElement>(`[${MARK}]`)
      if (!qualified) {
        if (existing !== null) removeButton(existing)
        continue
      }
      const row = findActionsRow(flowItem)
      if (row === null) continue
      let button: HTMLButtonElement | null = existing
      if (button === null) {
        button = document.createElement('button')
        button.type = 'button'
        button.className = css.action ?? ''
        button.setAttribute(MARK, 'true')
        button.setAttribute('aria-label', '回滚到此消息之前')
        button.setAttribute('title', '恢复此消息发送前的文件和对话。此消息之后的本地修改会丢失。')
        button.appendChild(icon.cloneNode(true))
        button.addEventListener('click', () => {
          if (pending) return
          const id = deps.list.getSnapshot().current
          const point = id === undefined ? undefined : deps.controllerFor(id).getSnapshot().value?.messageId
          if (id === undefined || point === undefined) return
          pending = true
          scan()
          void deps.undo(id, point).finally(() => {
            pending = false
            scan()
          })
        })
        owned.add(button)
        row.appendChild(button)
      } else if (button.parentElement !== row) {
        row.appendChild(button)
      }
      button.disabled = disabled
    }
    // Buttons whose flow item left the DOM entirely (session switch).
    for (const button of [...owned]) {
      if (!button.isConnected) removeButton(button)
    }
  }

  scan()
  const observer = new MutationObserver(scan)
  observer.observe(document.body, { childList: true, subtree: true })
  const disposeList = deps.list.subscribe(scan)
  const controllerDisposers = new Map<SessionId, () => void>()
  const trackController = (): void => {
    const current = deps.list.getSnapshot().current
    if (current === undefined || controllerDisposers.has(current)) return
    controllerDisposers.set(current, deps.controllerFor(current).subscribe(scan))
  }
  trackController()
  const disposeTrack = deps.list.subscribe(trackController)

  return () => {
    observer.disconnect()
    disposeList()
    disposeTrack()
    for (const dispose of controllerDisposers.values()) dispose()
    controllerDisposers.clear()
    for (const button of [...owned]) removeButton(button)
  }
}
