// @vitest-environment jsdom
/** Nav-glyph patch behavior inside the shared Settings shell (jsdom). */
import { afterEach, describe, expect, it, vi } from 'vitest'

/** The primitives entry pulls katex CSS (unloadable under node); the DOM
 * surgery under test only needs a distinct svg element to clone. */
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconArchiveOutline20: () => <svg aria-hidden="true" />,
}))

import { mountArchiveNavIconPatch } from '../src/client/navIconPatch.tsx'

/** Build one Settings nav row: dialog > nav > button > (svg, span label). */
function makeRow(label: string): HTMLButtonElement {
  const dialog = document.createElement('div')
  dialog.setAttribute('role', 'dialog')
  const nav = document.createElement('nav')
  const button = document.createElement('button')
  const gear = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  gear.setAttribute('class', 'navIcon')
  const span = document.createElement('span')
  span.textContent = label
  button.append(gear, span)
  nav.append(button)
  dialog.append(nav)
  document.body.append(dialog)
  return button
}

describe('mountArchiveNavIconPatch', () => {
  const disposers: Array<() => void> = []

  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose()
    document.body.innerHTML = ''
  })

  it('hides the gear and inserts the archive clone on the matching row only', () => {
    const archive = makeRow('归档任务')
    const other = makeRow('模型')
    disposers.push(mountArchiveNavIconPatch(() => '归档任务'))
    expect(archive.dataset.navIcon).toBe('dshArchiveNavIcon')
    const clone = archive.children[0]!
    const gear = archive.children[1]
    expect(clone).toBeInstanceOf(SVGSVGElement)
    expect(clone.getAttribute('class')).toBe('navIcon')
    expect((gear as HTMLElement).style.display).toBe('none')
    expect(other.dataset.navIcon).toBeUndefined()
    expect(other.children[0]).toBeInstanceOf(SVGSVGElement)
    expect((other.children[0] as HTMLElement).style.display).toBe('')
  })

  it('is idempotent across repeated scans', () => {
    const archive = makeRow('归档任务')
    disposers.push(mountArchiveNavIconPatch(() => '归档任务'))
    const clonesAfterFirst = archive.querySelectorAll('svg').length
    // A second mount observes the same DOM; the patched marker keeps it stable.
    disposers.push(mountArchiveNavIconPatch(() => '归档任务'))
    expect(archive.querySelectorAll('svg').length).toBe(clonesAfterFirst)
    expect([...archive.querySelectorAll('svg')].filter(s => s.style.display === 'none')).toHaveLength(1)
  })

  it('patches a row that mounts after the observer starts', async () => {
    disposers.push(mountArchiveNavIconPatch(() => '归档任务'))
    const late = makeRow('归档任务')
    await new Promise(resolve => { setTimeout(resolve, 50) })
    expect(late.dataset.navIcon).toBe('dshArchiveNavIcon')
  })

  it('leaves rows alone when no label matches', () => {
    const row = makeRow('模型')
    disposers.push(mountArchiveNavIconPatch(() => '归档任务'))
    expect(row.dataset.navIcon).toBeUndefined()
    expect((row.children[0] as HTMLElement).style.display).toBe('')
  })
})
