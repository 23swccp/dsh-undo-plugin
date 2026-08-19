/**
 * Full Edge verification: trailfold bars + toolcard colors + delete-all style.
 * 1) Live session: bar present, history expanded, manual toggle works, colors intact.
 * 2) New live turn: bar shows 运行中 while streaming, auto-collapses on close.
 * 3) Settings → Archive Tasks: delete-all button rounded pill (needs ≥1 archive
 *    item; verified via computed style + screenshot).
 * Usage: node scripts/edge-verify.mjs
 */

import puppeteer from 'puppeteer-core'

const URL = process.env.DSH_WEB_URL ?? 'http://127.0.0.1:3080'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const SHOT = process.env.TEMP + '\\edge-verify'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: false,
  defaultViewport: { width: 1440, height: 900 },
  args: ['--no-first-run', '--disable-infobars', '--user-data-dir=' + process.env.TEMP + '\\edge-verify-' + Date.now()],
})
const page = await browser.newPage()
page.on('pageerror', err => console.log(`[pageerror] ${err.message.slice(0, 200)}`))
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 90_000 })
await sleep(7_000)

// ── 1. Live session: bar + toggle + colors ──────────────────────────────
await page.evaluate(() => {
  [...document.querySelectorAll('div[role="treeitem"]')]
    .find(r => r.textContent?.includes('PowerShell'))?.click()
})
await sleep(9_000)
const step1 = await page.evaluate(() => {
  const bar = document.querySelector('[data-dsh-trailfold]')
  const trail = [...document.querySelectorAll('[data-chat-flow-kind="assistant-step"], [data-chat-flow-kind="tool-call"], [data-chat-flow-kind="context"]')]
  const conclusion = [...document.querySelectorAll('[data-chat-flow-kind="assistant-step"]')].pop()
  const cards = [...document.querySelectorAll('[data-terminal],[data-diff],[data-read],[data-search],[data-web]')]
    .map(c => (c.closest('[data-tool]')?.getAttribute('data-tool')) + ':' + getComputedStyle(c).backgroundColor)
  return {
    barPresent: bar !== null,
    aria: bar?.getAttribute('aria-expanded'),
    barText: bar?.textContent,
    trailCount: trail.length,
    conclusionVisible: conclusion instanceof HTMLElement && conclusion.style.display !== 'none',
    cards,
  }
})
console.log('=== STEP 1: history turn ===')
console.log(JSON.stringify(step1, null, 2))
await page.screenshot({ path: SHOT + '-1-history.png' })

// Manual toggle: collapse → trail hidden → expand back.
const toggled = await page.evaluate(() => {
  const bar = document.querySelector('[data-dsh-trailfold]')
  bar?.click()
  const hiddenAfterCollapse = [...document.querySelectorAll('[data-chat-flow-kind="tool-call"], [data-chat-flow-kind="assistant-step"]')]
    .filter(el => el instanceof HTMLElement && el.style.display === 'none').length
  const conclusionVisible = [...document.querySelectorAll('[data-chat-flow-kind="assistant-step"]')]
    .pop()?.style.display !== 'none'
  const tailVisible = document.querySelector('[data-chat-flow-kind="turn-tail"]')?.style.display !== 'none'
  bar?.click()
  const hiddenAfterExpand = [...document.querySelectorAll('[data-chat-flow-kind="tool-call"], [data-chat-flow-kind="assistant-step"]')]
    .filter(el => el instanceof HTMLElement && el.style.display === 'none').length
  return { ariaAfterCollapse: bar?.getAttribute('aria-expanded'), hiddenAfterCollapse, conclusionVisible, tailVisible, hiddenAfterExpand }
})
console.log('=== STEP 1b: manual toggle ===')
console.log(JSON.stringify(toggled))
await page.screenshot({ path: SHOT + '-2-collapsed.png' })

// ── 2. New live turn: running bar → auto-collapse on close ─────────────
await page.click('textarea')
await page.keyboard.type('用 PowerShell 运行 Get-Date 输出当前时间,然后用一句话告诉我现在几点。')
await page.keyboard.press('Enter')
console.log('prompt sent; streaming...')
let sawRunning = false
let collapsedAfterClose = null
for (let i = 0; i < 36; i++) {
  await sleep(5_000)
  const s = await page.evaluate(() => {
    const bars = [...document.querySelectorAll('[data-dsh-trailfold]')]
    const last = bars[bars.length - 1]
    return {
      bars: bars.length,
      lastAria: last?.getAttribute('aria-expanded'),
      lastText: last?.textContent,
      running: bars.some(b => b.textContent?.includes('运行中')),
    }
  })
  if (s.running) sawRunning = true
  if (i % 4 === 0) console.log(`  t=${(i + 1) * 5}s bars=${s.bars} last=${s.lastAria} "${s.lastText}"`)
  if (s.bars >= 2 && !s.running && s.lastAria === 'false') { collapsedAfterClose = s; break }
}
console.log('=== STEP 2: live turn ===')
console.log(JSON.stringify({ sawRunning, collapsedAfterClose }))
await page.screenshot({ path: SHOT + '-3-autocollapsed.png' })

// ── 3. Archive settings: delete-all button style ───────────────────────
await page.evaluate(() => {
  const gear = [...document.querySelectorAll('button')]
    .find(b => (b.getAttribute('aria-label') ?? '').includes('设置'))
  gear?.click()
})
await sleep(3_000)
await page.evaluate(() => {
  const nav = [...document.querySelectorAll('div[role="dialog"] nav button, [role="dialog"] button')]
    .find(b => b.textContent?.includes('归档任务'))
  nav?.click()
})
await sleep(6_000)
const step3 = await page.evaluate(() => {
  const rows = document.querySelectorAll('li, .item')
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === '全部删除')
  if (btn === undefined) return { button: false, rowCount: rows.length }
  const cs = getComputedStyle(btn)
  return {
    button: true,
    rowCount: rows.length,
    radius: cs.borderRadius,
    height: cs.height,
    bg: cs.backgroundColor,
    border: cs.border,
    font: cs.fontSize + ' ' + cs.fontFamily.slice(0, 30),
  }
})
console.log('=== STEP 3: archive delete-all ===')
console.log(JSON.stringify(step3, null, 2))
await page.screenshot({ path: SHOT + '-4-archive.png' })

await browser.close()
console.log('Done. Screenshots: ' + SHOT + '-*.png')
