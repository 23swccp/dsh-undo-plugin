/**
 * Per-turn "reasoning and actions" fold for the dsh web conversation trail.
 *
 * dsh's chat flow publishes one stable contract per node: the flow container
 * `[data-chat-flow]` whose children carry `data-chat-flow-kind` (user /
 * context / assistant-step / tool-call / turn-tail) and a stable
 * `data-chat-flow-key`. A turn therefore reads, in order: the user item, its
 * trail (context injections, Think steps, narration steps, tool calls), the
 * final assistant step (the conclusion — the element anchored right before
 * the turn tail), and the turn tail itself (deliverables + stats).
 *
 * This patch gives every turn with a foldable trail one collapse bar, so the
 * affordance shows in ALL cases where there is anything to fold — including
 * think-only and text-only-with-reasoning turns, which is what the fork's
 * main-tree trail fold did and what plain per-tool rows cannot express.
 *
 * React safety rules (the navIconPatch lessons):
 *   - never remove or reorder React-owned nodes: hiding happens by setting
 *     `style.display` on flow items (they carry no React-managed style prop),
 *     and the collapse bar is a foreign node React never reconciles;
 *   - everything is idempotent and re-derived: a MutationObserver rescans on
 *     every mutation batch, so React re-renders, virtualization remounts, and
 *     locale/edits heal automatically (a dropped bar is simply re-inserted).
 *
 * Fold semantics (main-tree parity):
 *   - the conclusion (last assistant step before the tail) and the tail
 *     itself stay visible — only the trail folds;
 *   - a running turn (no tail yet) renders the bar expanded with a running
 *     hint and never auto-collapses mid-stream;
 *   - a turn that closes while observed auto-collapses — but only when the
 *     conversation is pinned near the bottom (following), so a reader scrolled
 *     up into the trail is never cut off;
 *   - history that loads already-collapsed stays expanded on first sight;
 *   - manual clicks always win until the turn's next auto event (its close);
 *   - a closed turn with no assistant-step conclusion (e.g. it ended on an
 *     erroring tool call) gets no bar — errors stay visible.
 */

/** Marker on the foreign collapse-bar root, carrying the turn's flow key. */
const BAR_MARK = 'dshTrailfold'

/** Flow-item kinds that belong to a turn's trail (never user, tail, or unknown kinds). */
const TRAIL_KINDS: ReadonlySet<string> = new Set(['context', 'assistant-step', 'tool-call'])

/** One flow node as the planner sees it. */
export interface FlowItem {
  readonly el: HTMLElement
  readonly kind: string
  readonly key: string
}

/** What the planner derived for one user-anchored turn. */
export interface TurnPlan {
  /** The user item's stable flow key (identity of the turn). */
  readonly key: string
  /** The user message item (always visible; the bar sits right after it). */
  readonly userEl: HTMLElement
  /** Trail nodes hidden while collapsed (excludes the conclusion). */
  readonly trail: readonly HTMLElement[]
  /** The conclusion step anchored before the tail; null while running or when the turn is not foldable. */
  readonly conclusion: HTMLElement | null
  /** True once the turn-tail arrived (or a newer user item abandoned it). */
  readonly closed: boolean
  /** True while the tail has not arrived and this is the live end of the flow. */
  readonly running: boolean
  /** Count of assistant steps inside the trail (Think + narration). */
  readonly thinkCount: number
  /** Count of tool calls inside the trail. */
  readonly toolCount: number
}

/**
 * Group flow items into user-anchored turns and derive each turn's fold plan.
 * Unknown kinds are passed through untouched (never boundary, never trail).
 * @param items - Flow children in document order.
 * @returns One plan per user item, in order.
 */
export function planTurns(items: readonly FlowItem[]): readonly TurnPlan[] {
  interface RawTurn {
    readonly key: string
    readonly userEl: HTMLElement
    readonly trailAll: FlowItem[]
    closed: boolean
    closedByTail: boolean
  }
  const raws: RawTurn[] = []
  let current: RawTurn | null = null
  for (const item of items) {
    if (item.kind === 'user') {
      if (current !== null) {
        current.closed = true
        current.closedByTail = false
      }
      current = { key: item.key, userEl: item.el, trailAll: [], closed: false, closedByTail: false }
      raws.push(current)
      continue
    }
    if (item.kind === 'turn-tail') {
      if (current !== null) {
        current.closed = true
        current.closedByTail = true
        current = null
      }
      continue
    }
    if (current !== null && TRAIL_KINDS.has(item.kind)) current.trailAll.push(item)
  }
  // A turn still open at the end of the flow is the live, running turn.
  const plans: TurnPlan[] = []
  for (const raw of raws) {
    const running = !raw.closed
    const last = raw.trailAll[raw.trailAll.length - 1]
    // Only a tail-anchored close can prove a conclusion; an abandoned turn
    // (next user message arrived, no tail) keeps everything visible.
    const conclusion = raw.closedByTail && last !== undefined && last.kind === 'assistant-step'
      ? last.el
      : null
    const trail = conclusion !== null ? raw.trailAll.slice(0, -1) : raw.trailAll
    plans.push({
      key: raw.key,
      userEl: raw.userEl,
      trail: trail.map(i => i.el),
      conclusion,
      closed: raw.closed,
      running,
      thinkCount: trail.filter(i => i.kind === 'assistant-step').length,
      toolCount: trail.filter(i => i.kind === 'tool-call').length,
    })
  }
  return plans
}

/** A fold gets a bar iff there is a trail to hide: running with items, or closed with an anchored conclusion. */
export function foldable(plan: TurnPlan): boolean {
  if (plan.trail.length === 0) return false
  return plan.running || plan.conclusion !== null
}

interface TurnState {
  collapsed: boolean
  wasRunning: boolean
}

const CHEVRON = '<svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true" focusable="false">'
  + '<path d="M3.5 5.25L7 8.75l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.5"'
  + ' stroke-linecap="round" stroke-linejoin="round"/></svg>'

/**
 * Wire the fold into one live document.
 * @param doc - Document hosting the conversation (tests may pass a jsdom one).
 * @param classes - CSS-module class map for the bar chrome.
 * @param labels - Copy: bar title, running hint, and the count line builder.
 * @returns Disposer stopping the observer and dropping every foreign bar.
 */
export function mountTrailFold(
  doc: Document,
  classes: Record<string, string>,
  labels: {
    readonly title: string
    readonly running: string
    readonly counts: (think: number, tools: number) => string
  },
): () => void {
  const states = new Map<string, TurnState>()
  const bars = new Map<string, HTMLElement>()

  /** Conversation pinned near the bottom (following the stream)? Absent scroller counts as pinned. */
  const pinnedToBottom = (): boolean => {
    const scroller = doc.querySelector('[data-conversation-scroll]')
    if (scroller === null) return true
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80
  }

  const applyVisibility = (plan: TurnPlan, collapsed: boolean): void => {
    for (const el of plan.trail) el.style.display = collapsed ? 'none' : ''
  }

  const buildBar = (plan: TurnPlan): HTMLElement => {
    const bar = doc.createElement('div')
    bar.className = classes.bar ?? ''
    bar.dataset[BAR_MARK] = plan.key
    bar.setAttribute('role', 'button')
    bar.setAttribute('tabindex', '0')
    bar.innerHTML =
      `<span class="${classes.chevron ?? ''}" data-part="chevron">${CHEVRON}</span>`
      + `<span class="${classes.label ?? ''}" data-part="label">${labels.title}</span>`
      + `<span class="${classes.counts ?? ''}" data-part="counts"></span>`
    const toggle = (): void => {
      const state = states.get(plan.key)
      if (state === undefined) return
      state.collapsed = !state.collapsed
      sync(plan, state)
    }
    bar.addEventListener('click', toggle)
    bar.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      toggle()
    })
    return bar
  }

  /** Push state into one turn's bar + trail visibility. */
  const sync = (plan: TurnPlan, state: TurnState): void => {
    const bar = bars.get(plan.key)
    if (bar !== undefined) {
      bar.setAttribute('aria-expanded', state.collapsed ? 'false' : 'true')
      // Write text/transform ONLY on change: assigning textContent replaces
      // the text node even for an identical value, which is a childList
      // mutation under our own observer and would loop the scan forever.
      const counts = bar.querySelector<HTMLElement>('[data-part="counts"]')
      const nextCounts = plan.running ? labels.running : labels.counts(plan.thinkCount, plan.toolCount)
      if (counts !== null && counts.textContent !== nextCounts) counts.textContent = nextCounts
      const chevron = bar.querySelector<HTMLElement>('[data-part="chevron"]')
      const nextTransform = state.collapsed ? 'rotate(-90deg)' : ''
      if (chevron !== null && chevron.style.transform !== nextTransform) chevron.style.transform = nextTransform
    }
    applyVisibility(plan, state.collapsed)
  }

  const scan = (): void => {
    const flows = [...doc.querySelectorAll('[data-chat-flow]')]
    const seen = new Set<string>()
    for (const flow of flows) {
      const items: FlowItem[] = []
      for (const el of [...flow.children]) {
        if (!(el instanceof HTMLElement)) continue
        const kind = el.getAttribute('data-chat-flow-kind')
        if (kind === null) continue
        items.push({ el, kind, key: el.getAttribute('data-chat-flow-key') ?? '' })
      }
      for (const plan of planTurns(items)) {
        seen.add(plan.key)
        if (!foldable(plan)) {
          const bar = bars.get(plan.key)
          if (bar !== undefined && bar.isConnected) bar.remove()
          bars.delete(plan.key)
          states.delete(plan.key)
          applyVisibility(plan, false)
          continue
        }
        let state = states.get(plan.key)
        if (state === undefined) {
          state = { collapsed: false, wasRunning: plan.running }
          states.set(plan.key, state)
        } else if (state.wasRunning && plan.closed) {
          // The turn closed while we watch: auto-fold only when following.
          state.wasRunning = false
          state.collapsed = pinnedToBottom()
        }
        let bar = bars.get(plan.key)
        if (bar === undefined || !bar.isConnected) {
          if (bar !== undefined && bar.isConnected === false) bars.delete(plan.key)
          bar = buildBar(plan)
          bars.set(plan.key, bar)
        }
        const anchor = plan.trail[0]
        if (anchor !== undefined && anchor.previousSibling !== bar && anchor.parentElement === flow) {
          flow.insertBefore(bar, anchor)
        }
        sync(plan, state)
      }
    }
    for (const [key, bar] of [...bars]) {
      if (seen.has(key)) continue
      bar.remove()
      bars.delete(key)
      states.delete(key)
    }
  }

  scan()
  const observer = new MutationObserver(scan)
  observer.observe(doc.body, { childList: true, subtree: true })
  return () => {
    observer.disconnect()
    for (const bar of bars.values()) bar.remove()
    bars.clear()
    states.clear()
  }
}
