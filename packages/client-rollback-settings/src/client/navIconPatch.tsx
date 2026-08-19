/**
 * Archive Tasks nav-glyph patch for the shared Settings shell.
 *
 * dsh's SettingsRoot maps nav icons from a hardcoded id set (models /
 * agent-presets / plugins); every other section id falls back to the settings
 * gear. The registry offers no icon field on `settings.section`, so this
 * plugin renders IconArchiveOutline20 from the host module table next to the
 * gear of its own nav row — the same mapping the fork's main-tree NAV_ICONS
 * fix installs, delivered client-side so npm-hosted dsh builds get it too.
 *
 * The row's children belong to the shell's React tree: the gear is only
 * hidden (never unlinked — removing it breaks React's diff and blanks the
 * label), and the archive clone is inserted as a foreign node React leaves
 * alone across re-renders.
 */

import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { IconArchiveOutline20 } from '@deepseek-ai/dsh-client-ui-primitives'

/** Dataset marker on a nav row once its glyph has been patched. */
const PATCHED = 'dshArchiveNavIcon'

/**
 * Patch one nav row when it is this section's row.
 * @param button - One Settings nav row button.
 * @param label - Current locale label of the Archive Tasks section.
 * @param icon - Rendered archive icon to clone into the row.
 */
function patchRow(button: HTMLButtonElement, label: string, icon: SVGSVGElement): void {
  if (button.dataset.navIcon === PATCHED) return
  const span = button.querySelector('span')
  if (span?.textContent !== label) return
  const gear = button.firstElementChild
  if (!(gear instanceof SVGSVGElement)) return
  gear.style.display = 'none'
  const clone = icon.cloneNode(true) as SVGSVGElement
  clone.setAttribute('class', gear.getAttribute('class') ?? '')
  button.insertBefore(clone, gear)
  button.dataset.navIcon = PATCHED
}

/**
 * Keep the Archive Tasks nav glyph patched for the lifetime of this plugin:
 * the Settings dialog mounts per open, and locale changes rewrite row labels,
 * so every mutation re-runs the idempotent scan.
 * @param label - Reads the current locale label of the section.
 * @returns Disposer that stops observing and drops the icon template.
 */
export function mountArchiveNavIconPatch(label: () => string): () => void {
  // Render the icon once, synchronously, in an offscreen template.
  const template = document.createElement('span')
  template.style.display = 'none'
  document.body.appendChild(template)
  const root = createRoot(template)
  flushSync(() => { root.render(<IconArchiveOutline20 size={16} />) })
  const icon = template.firstElementChild
  if (!(icon instanceof SVGSVGElement)) {
    template.remove()
    void root.unmount()
    return () => {}
  }
  const patchAll = (): void => {
    for (const button of document.querySelectorAll<HTMLButtonElement>('div[role="dialog"] nav button')) {
      patchRow(button, label(), icon)
    }
  }
  patchAll()
  const observer = new MutationObserver(patchAll)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  return () => {
    observer.disconnect()
    void root.unmount()
    template.remove()
  }
}
