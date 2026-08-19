// @vitest-environment jsdom
/** Trail-fold planner and DOM patch behavior (jsdom). */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountTrailFold, planTurns, foldable } from '../src/client/trailfold.ts'

// File-level cleanup: every flow built by any describe must leave the body —
// mountTrailFold (correctly) folds every [data-chat-flow] it finds, so a stale
// planner-test flow would grow a bar and steal document.querySelector.
afterEach(() => { document.body.innerHTML = '' })

const CLASSES = { bar: 'tf-bar', chevron: 'tf-chevron', label: 'tf-label', counts: 'tf-counts' }
const LABELS = {
  title: '推理与行动',
  running: '运行中…',
  counts: (think: number, tools: number) => [think > 0 ? `${think} 思考` : '', tools > 0 ? `${tools} 工具` : ''].filter(Boolean).join(' · '),
}

/** Build one flow item element with the renderer's stable attributes. */
function item(kind: string, key: string): HTMLElement {
  const el = document.createElement('div')
  el.setAttribute('data-chat-flow-kind', kind)
  el.setAttribute('data-chat-flow-key', key)
  el.textContent = `${kind}:${key}`
  return el
}

/** Build a chat flow from kind tokens; returns the container plus child handles by token. */
function flowOf(kinds: readonly string[]): { container: HTMLElement; els: Record<string, HTMLElement> } {
  const container = document.createElement('div')
  container.setAttribute('data-chat-flow', '')
  const els: Record<string, HTMLElement> = {}
  let n = 0
  for (const kind of kinds) {
    const key = `${kind}-${n++}`
    const el = item(kind, key)
    els[key] = el
    container.append(el)
  }
  document.body.append(container)
  return { container, els }
}

const listOf = (container: HTMLElement) =>
  [...container.children].filter(el => el.hasAttribute('data-chat-flow-kind')).map(el => ({
    el: el as HTMLElement,
    kind: el.getAttribute('data-chat-flow-kind') ?? '',
    key: el.getAttribute('data-chat-flow-key') ?? '',
  }))

describe('planTurns', () => {
  it('folds the trail but anchors the conclusion before the tail', () => {
    const { container } = flowOf(['user', 'context', 'assistant-step', 'tool-call', 'assistant-step', 'turn-tail'])
    const [plan] = planTurns(listOf(container))
    expect(plan).toBeDefined()
    expect(plan!.closed).toBe(true)
    expect(plan!.running).toBe(false)
    expect(plan!.trail).toHaveLength(3)
    expect(plan!.conclusion?.getAttribute('data-chat-flow-kind')).toBe('assistant-step')
    expect(plan!.thinkCount).toBe(1)
    expect(plan!.toolCount).toBe(1)
    expect(foldable(plan!)).toBe(true)
  })

  it('treats a turn without a tail as running with everything as trail', () => {
    const { container } = flowOf(['user', 'assistant-step', 'tool-call'])
    const [plan] = planTurns(listOf(container))
    expect(plan!.running).toBe(true)
    expect(plan!.conclusion).toBeNull()
    expect(plan!.trail).toHaveLength(2)
    expect(foldable(plan!)).toBe(true)
  })

  it('refuses to fold a closed turn that ends on a tool call (errors stay visible)', () => {
    const { container } = flowOf(['user', 'assistant-step', 'tool-call', 'turn-tail'])
    const [plan] = planTurns(listOf(container))
    expect(plan!.conclusion).toBeNull()
    expect(foldable(plan!)).toBe(false)
  })

  it('refuses to fold a turn abandoned by the next user message', () => {
    const { container } = flowOf(['user', 'assistant-step', 'tool-call', 'user', 'assistant-step', 'assistant-step', 'turn-tail'])
    const [first, second] = planTurns(listOf(container))
    expect(first!.closed).toBe(true)
    expect(first!.conclusion).toBeNull()
    expect(foldable(first!)).toBe(false)
    expect(foldable(second!)).toBe(true)
  })

  it('skips a turn with an empty trail (nothing to fold)', () => {
    const { container } = flowOf(['user', 'assistant-step', 'turn-tail'])
    const [plan] = planTurns(listOf(container))
    expect(plan!.trail).toHaveLength(0)
    expect(foldable(plan!)).toBe(false)
  })
})

describe('mountTrailFold', () => {
  const disposers: Array<() => void> = []

  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose()
  })

  it('inserts one bar above the trail, toggles visibility, keeps conclusion and tail', () => {
    const { container } = flowOf(['user', 'assistant-step', 'tool-call', 'assistant-step', 'turn-tail'])
    disposers.push(mountTrailFold(document, CLASSES, LABELS))
    const bar = document.querySelector<HTMLElement>('[data-dsh-trailfold]')
    expect(bar).not.toBeNull()
    const byKind = (kind: string, nth = 0) =>
      container.querySelectorAll(`[data-chat-flow-kind="${kind}"]`)[nth] as HTMLElement
    const user = byKind('user')
    const think = byKind('assistant-step')
    const tool = byKind('tool-call')
    const conclusion = byKind('assistant-step', 1)
    expect(bar!.nextElementSibling).toBe(think)
    expect(bar!.getAttribute('aria-expanded')).toBe('true')
    expect(user.style.display).toBe('')
    expect(conclusion.style.display).toBe('')

    bar!.click()
    expect(bar!.getAttribute('aria-expanded')).toBe('false')
    expect(think.style.display).toBe('none')
    expect(tool.style.display).toBe('none')
    expect(conclusion.style.display).toBe('')
    expect(user.style.display).toBe('')

    bar!.click()
    expect(think.style.display).toBe('')
    expect(tool.style.display).toBe('')
  })

  it('auto-collapses a running turn once its tail arrives (pinned scroller absent = following)', async () => {
    const { container } = flowOf(['user', 'assistant-step', 'tool-call'])
    disposers.push(mountTrailFold(document, CLASSES, LABELS))
    const bar = document.querySelector<HTMLElement>('[data-dsh-trailfold]')
    expect(bar?.getAttribute('aria-expanded')).toBe('true')
    expect(bar?.textContent).toContain('运行中')

    const conclusion = item('assistant-step', 'assistant-step-9')
    const tail = item('turn-tail', 'turn-tail-9')
    container.append(conclusion, tail)
    await vi.waitFor(() => {
      expect(bar?.getAttribute('aria-expanded')).toBe('false')
    })
    const think = container.querySelector('[data-chat-flow-kind="assistant-step"]') as HTMLElement
    expect(think.style.display).toBe('none')
    expect(conclusion.style.display).toBe('')
  })

  it('leaves history expanded on first sight and adds no bar for unfoldable turns', () => {
    const { container } = flowOf(['user', 'tool-call', 'turn-tail', 'user', 'assistant-step', 'tool-call', 'assistant-step', 'turn-tail'])
    disposers.push(mountTrailFold(document, CLASSES, LABELS))
    const bars = [...document.querySelectorAll('[data-dsh-trailfold]')]
    expect(bars).toHaveLength(1)
    expect(bars[0]!.getAttribute('aria-expanded')).toBe('true')
    // The first turn ends on a tool call (no conclusion) — visible, no bar.
    const firstTool = container.querySelector('[data-chat-flow-kind="tool-call"]') as HTMLElement
    expect(firstTool.style.display).toBe('')
    // The foldable history turn's trail stays expanded on first sight.
    const think = container.querySelectorAll('[data-chat-flow-kind="assistant-step"]')[0] as HTMLElement
    expect(think.style.display).toBe('')
  })

  it('removes its bars on dispose', () => {
    flowOf(['user', 'assistant-step', 'assistant-step', 'turn-tail'])
    const dispose = mountTrailFold(document, CLASSES, LABELS)
    expect(document.querySelectorAll('[data-dsh-trailfold]')).toHaveLength(1)
    dispose()
    expect(document.querySelectorAll('[data-dsh-trailfold]')).toHaveLength(0)
  })
})
