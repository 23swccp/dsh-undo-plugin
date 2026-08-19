/**
 * Diagnostic / verification probe for tool-call cards in the dsh web UI.
 *
 * Opens a persisted session (no API key needed — rendering replays the stored
 * transcript), then reports:
 *   1. whether tool rows render as expandable disclosure bars (collapse bar),
 *   2. the computed background of each expanded content card per tool type.
 *
 * Cache is disabled via CDP so every load is the equivalent of Ctrl+Shift+R.
 * Usage: node scripts/e2e-toolcards.mjs [sessionIdFragment]
 */

import puppeteer from 'puppeteer-core'

const URL = process.env.DSH_WEB_URL ?? 'http://127.0.0.1:3080'
const CHROME = process.env.CHROME
  ?? (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : '/usr/bin/google-chrome')
const FRAGMENT = process.argv[2] ?? ''
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  defaultViewport: { width: 1440, height: 900 },
  args: ['--no-first-run', '--disable-infobars'],
})
const page = await browser.newPage()
const client = await page.createCDPSession()
await client.send('Network.setCacheDisabled', { cacheDisabled: true })
page.on('pageerror', err => console.log(`[pageerror] ${err.message}`))

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 90_000 })
await sleep(6_000)

// --- iterate session rows until one shows tool rows ---
const titles = await page.evaluate(() =>
  [...document.querySelectorAll('div[role="treeitem"]')].map(r => r.textContent?.slice(0, 50) ?? ''))
console.log(`session rows: ${titles.length}`)
console.log(titles.map((t, i) => `  [${i}] ${t}`).join('\n'))

const pick = FRAGMENT === ''
  ? titles.map((_, i) => i)
  : titles.map((t, i) => [t, i]).filter(([t]) => t.includes(FRAGMENT)).map(([, i]) => i)
let opened = -1
for (const i of pick) {
  await page.evaluate(idx => {
    const rows = [...document.querySelectorAll('div[role="treeitem"]')]
    rows[idx]?.click()
  }, i)
  await sleep(8_000)
  const count = await page.evaluate(() =>
    document.querySelectorAll('[data-tool], [data-sample="bash"]').length)
  console.log(`  row [${i}] "${titles[i]}" -> tool rows: ${count}`)
  if (count > 0) { opened = i; break }
}
console.log(`opened session row: ${opened}`)

// --- scan tool rows & expand every expandable one, then read card styles ---
const report = await page.evaluate(async () => {
  const rows = [...document.querySelectorAll('[data-tool], [data-sample="bash"]')]
  const out = {
    rowCount: rows.length,
    rows: [],
    uiToolStyleTag: document.querySelector('style[data-plugin-css*="ui-tool"]') !== null,
  }
  const bg = el => el ? getComputedStyle(el).backgroundColor : null
  for (const row of rows) {
    const info = {
      tool: row.getAttribute('data-tool') ?? row.getAttribute('data-sample'),
      variant: row.getAttribute('data-variant'),
      state: row.getAttribute('data-state'),
      expandable: row.getAttribute('data-expandable') !== null || row.querySelector('[aria-expanded]') !== null,
    }
    // Click the row header to expand (BashRow: the row itself; ToolRow: the
    // disclosure row inside).
    const clickTarget = row.matches('[data-sample="bash"]') ? row : row.querySelector('[aria-expanded]')
    if (clickTarget) {
      clickTarget.click()
      await new Promise(r => setTimeout(r, 120))
    }
    const card = row.querySelector('[data-terminal], [data-diff], [data-read], [data-search], [data-web]')
    info.cardKind = card
      ? (card.hasAttribute('data-terminal') ? 'terminal'
        : card.hasAttribute('data-diff') ? 'diff'
          : card.hasAttribute('data-read') ? 'read'
            : card.hasAttribute('data-search') ? 'search' : 'web')
      : null
    info.cardBg = card ? bg(card) : null
    out.rows.push(info)
  }
  const summary = {}
  for (const r of out.rows) {
    const key = `${r.tool}/${r.cardKind ?? 'none'}`
    summary[key] = summary[key] ?? { count: 0, bgs: new Set() }
    summary[key].count += 1
    if (r.cardBg) summary[key].bgs.add(r.cardBg)
  }
  out.summary = Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, { count: v.count, bgs: [...v.bgs] }]))
  return out
})
console.log('=== TOOL ROW SCAN ===')
console.log(`ui-tool style tag present: ${report.uiToolStyleTag}`)
console.log(JSON.stringify(report.summary, null, 2))

// --- synthesized bash row: the BashRow hooks cannot be exercised on Windows
// (the bash tool is disabled there), so replicate its DOM shape — card wrapper
// with [data-sample="bash"] row + sibling bodyWrap holding the card div — and
// read the cascade's answer.
const bashCheck = await page.evaluate(() => {
  const card = document.createElement('div')
  const row = document.createElement('div')
  row.setAttribute('data-sample', 'bash')
  const body = document.createElement('div')
  const terminal = document.createElement('div')
  terminal.setAttribute('data-terminal', '')
  body.append(terminal)
  card.append(row, body)
  document.body.append(card)
  const bg = getComputedStyle(terminal).backgroundColor
  const label = getComputedStyle(terminal).getPropertyValue('--dsw-alias-label-primary').trim()
  card.remove()
  return { bg, label }
})
console.log('=== SYNTHESIZED BASH ROW ===')
console.log(JSON.stringify(bashCheck))

await browser.close()
