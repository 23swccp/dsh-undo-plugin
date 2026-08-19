/** Toolcard color contract: the stylesheet this plugin injects. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { apply, inject } from '../src/client/index.ts'

const css = readFileSync(
  fileURLToPath(new URL('../src/client/toolcards.module.css', import.meta.url)),
  'utf8',
)

/** Assert one rule block (selector up to the closing brace) exists verbatim enough. */
function hasRule(selector: string): boolean {
  return css.includes(selector)
}

describe('toolcards stylesheet contract', () => {
  it('colors the bash card near-black via the BashRow sibling body hook', () => {
    expect(hasRule('[data-sample="bash"] + div > div')).toBe(true)
    expect(hasRule('[data-tool="bash"] [data-terminal]')).toBe(true)
    // Static dark shell: background pinned, not theme-following.
    const bashBlock = css.slice(css.indexOf('[data-sample="bash"]'))
    expect(bashBlock).toContain('background: #0d1117')
    expect(bashBlock).toContain('--dsw-alias-markdown-code-block: #0d1117')
  })

  it('colors the pwsh terminal card PowerShell-window blue', () => {
    expect(hasRule('[data-tool="pwsh"] [data-terminal]')).toBe(true)
    const pwshBlock = css.slice(css.indexOf('[data-tool="pwsh"]'))
    expect(pwshBlock).toContain('background: #012456')
    expect(pwshBlock).toContain('--dsw-alias-label-primary: #eaf1ff')
  })

  it('tints edit/write diff cards green over the theme code-block color', () => {
    expect(hasRule('[data-tool="edit"] [data-diff]')).toBe(true)
    expect(hasRule('[data-tool="write"] [data-diff]')).toBe(true)
    expect(css).toContain('color-mix(in srgb, #2da44e 12%, var(--dsw-alias-markdown-code-block))')
  })

  it('tints read cards violet and grep/glob search cards blue with stronger banners', () => {
    expect(hasRule('[data-tool="read"] [data-read]')).toBe(true)
    expect(hasRule('[data-tool="grep"] [data-search]')).toBe(true)
    expect(hasRule('[data-tool="glob"] [data-search]')).toBe(true)
    expect(css).toContain('--dsw-alias-markdown-code-block-banner: color-mix(in srgb, #8957e5 14%')
    expect(css).toContain('--dsw-alias-markdown-code-block-banner: color-mix(in srgb, #4493f8 14%')
  })

  it('tints web retrieval cards teal and run_code code cards amber', () => {
    expect(hasRule('[data-tool="web_search"] [data-web]')).toBe(true)
    expect(hasRule('[data-tool="web_fetch"] [data-web]')).toBe(true)
    // :global() so the css-modules transform leaves the literal class unhashed.
    expect(hasRule('[data-tool="run_code"] :global(.md-code-block)')).toBe(true)
    expect(css).toContain('color-mix(in srgb, #12a5b0 10%')
    expect(css).toContain('color-mix(in srgb, #d29922 10%')
  })

  it('targets only stable renderer hooks, never hashed css-module classes', () => {
    // Hashed selectors (e.g. class="_block_10eou_7") would break on any dsh
    // rebuild; every selector must be attribute-based, and the one class
    // selector must be :global-wrapped so the build never hashes it. Comments
    // are stripped first so prose periods cannot trip the scan.
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/:global\([^)]*\)/g, '')
    for (const selector of bare.match(/(^|\})\s*([^{}]*)\{/g) ?? []) {
      expect(selector).not.toMatch(/_[0-9a-zA-Z]{5}_/)
      expect(selector).not.toMatch(/\./)
    }
  })
})

describe('toolcards client entry', () => {
  it('requires no services and resolves to a disposer', async () => {
    expect(inject).toEqual([])
    const dispose = await apply()
    expect(typeof dispose).toBe('function')
    expect(dispose()).toBeUndefined()
  })
})
