/**
 * Timed rollback/revoke E2E (100ms polling resolution).
 *
 * Sequence: open the live 4242 session → send a fresh prompt → wait settle →
 * timed rollback (message-action button) → timed revoke (fold strip) → timed
 * rollback again (header button) → timed revoke again. Prints per-phase
 * wall-clock from click to session navigation.
 *
 * Usage: node scripts/edge-timing.mjs
 */

import puppeteer from 'puppeteer-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: false,
  defaultViewport: { width: 1440, height: 900 },
  args: ['--no-first-run', '--disable-infobars', '--user-data-dir=' + process.env.TEMP + '\\edge-timing-' + Date.now()],
})
const page = await browser.newPage()
await page.goto('http://127.0.0.1:3080', { waitUntil: 'networkidle2', timeout: 90_000 })
await sleep(7_000)

const currentId = () => page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem('dsh.sessions.current') ?? 'null')?.sessionId ?? null } catch { return null }
})
const settled = async () => page.evaluate(() => document.querySelectorAll('[data-state="running"]').length === 0)

/** Click and time until the current session id changes; returns ms (or null on timeout). */
async function timedNav(click, label, timeoutMs = 120_000) {
  const from = await currentId()
  const t0 = Date.now()
  await click()
  while (Date.now() - t0 < timeoutMs) {
    await sleep(100)
    if ((await currentId()) !== from) return { label, ms: Date.now() - t0 }
  }
  return { label, ms: null }
}

// Open the live session (stable literal 4242 in the title).
await page.evaluate(() => {
  ;[...document.querySelectorAll('div[role="treeitem"]')]
    .find(r => r.textContent?.includes('4242'))?.click()
})
await sleep(9_000)
console.log('session:', await currentId())

// Fresh prompt to arm a brand-new rollback point on this branch.
await page.click('textarea')
await page.keyboard.type('只回复 ok' + (Date.now() % 100000))
await page.keyboard.press('Enter')
console.log('prompt sent; waiting settle...')
for (let i = 0; i < 60; i++) {
  await sleep(3_000)
  if (await settled() && i > 1) break
}
await sleep(2_000)
console.log('settled. timing phases:')

// Phase 1: rollback via the message-action button.
const t1 = await timedNav(() => page.evaluate(() => {
  document.querySelector('[data-dsh-rollback-message-action]')?.click()
}), 'rollback #1 (message button)')
console.log(JSON.stringify(t1))
await sleep(5_000)

// Phase 2: revoke via the fold strip.
const t2 = await timedNav(() => page.evaluate(() => {
  const strip = [...document.querySelectorAll('[role="group"]')]
    .find(g => g.getAttribute('aria-label') === '可撤回的回滚')
  const btn = strip === undefined ? undefined : [...strip.querySelectorAll('button')]
    .find(b => b.textContent?.includes('撤回回滚'))
  btn?.click()
}), 'revoke #1 (fold strip)')
console.log(JSON.stringify(t2))
await sleep(5_000)

// Phase 3: rollback again via the header button.
const t3 = await timedNav(() => page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')]
    .find(b => b.getAttribute('aria-label') === '回滚到此消息之前')
  btn?.click()
}), 'rollback #2 (header button)')
console.log(JSON.stringify(t3))
await sleep(5_000)

// Phase 4: revoke again.
const t4 = await timedNav(() => page.evaluate(() => {
  const strip = [...document.querySelectorAll('[role="group"]')]
    .find(g => g.getAttribute('aria-label') === '可撤回的回滚')
  const btn = strip === undefined ? undefined : [...strip.querySelectorAll('button')]
    .find(b => b.textContent?.includes('撤回回滚'))
  btn?.click()
}), 'revoke #2 (fold strip)')
console.log(JSON.stringify(t4))

console.log('SUMMARY:', JSON.stringify([t1, t2, t3, t4].map(x => `${x.label}=${x.ms ?? 'timeout'}ms`)))
await browser.close()
