/**
 * Live Edge verification of the message-actions rollback button:
 *   1. Open a session with an armed rollback point → the qualified user
 *      message's actions row carries ONE enter-key-icon button after Copy
 *      (other user messages carry none).
 *   2. Icon path matches the composer send button's path verbatim.
 *   3. Button disabled while the session runs.
 *   4. Click → rollback executes → navigation to the child session, and the
 *      fold strip appears (regression of the full rollback path).
 *   5. Revoke to restore, and confirm the restored session's button is back.
 * Usage: node scripts/edge-verify-messageactions.mjs
 */

import puppeteer from 'puppeteer-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: false,
  defaultViewport: { width: 1440, height: 900 },
  args: ['--no-first-run', '--disable-infobars', '--user-data-dir=' + process.env.TEMP + '\\edge-ma-' + Date.now()],
})
const page = await browser.newPage()
page.on('pageerror', err => console.log(`[pageerror] ${err.message.slice(0, 200)}`))
await page.goto('http://127.0.0.1:3080', { waitUntil: 'networkidle2', timeout: 90_000 })
await sleep(7_000)

// Composer send icon path (the enter-key glyph reference).
const sendPath = await page.evaluate(() => {
  const seat = document.querySelector('[data-composer-seat]')
  const btn = seat === null ? null : [...seat.querySelectorAll('button')].filter(b => b.querySelector('svg')).pop()
  return btn?.querySelector('path')?.getAttribute('d') ?? null
})
console.log('composer send icon path:', sendPath?.slice(0, 40) + '...')

// Open the session carrying the armed point: the live "记住数字 4242" test
// session (title contains the stable literal 4242).
const titles = await page.evaluate(() =>
  [...document.querySelectorAll('div[role="treeitem"]')].map(r => r.textContent?.slice(0, 40) ?? ''))
console.log('sessions:', JSON.stringify(titles))

await page.evaluate(() => {
  ;[...document.querySelectorAll('div[role="treeitem"]')]
    .find(r => r.textContent?.includes('4242'))?.click()
})
await sleep(9_000)

let step1 = null
let opened = -1
const probe = await page.evaluate(() => ({
  buttons: document.querySelectorAll('[data-dsh-rollback-message-action]').length,
  users: document.querySelectorAll('[data-chat-flow-kind="user"]').length,
}))
console.log('probe:', JSON.stringify(probe))
if (probe.buttons > 0) opened = 1
console.log('opened session with button:', opened)

if (opened >= 0) {
  step1 = await page.evaluate(sendPath => {
    const button = document.querySelector('[data-dsh-rollback-message-action]')
    const flowItem = button.closest('[data-chat-flow-kind="user"]')
    const key = flowItem?.getAttribute('data-chat-flow-key')
    const actionsRow = button.parentElement
    const prev = button.previousElementSibling
    const prevIsCopyLike = prev?.querySelector('button') !== null || prev?.tagName === 'BUTTON'
    const btnPath = button.querySelector('path')?.getAttribute('d') ?? null
    return {
      aria: button.getAttribute('aria-label'),
      title: button.getAttribute('title')?.slice(0, 20),
      disabled: button.disabled,
      key,
      lastInRow: actionsRow?.lastElementChild === button,
      afterCopyLike: prevIsCopyLike,
      iconMatchesComposer: btnPath === sendPath,
      viewBox: button.querySelector('svg')?.getAttribute('viewBox'),
    }
  }, sendPath)
  console.log('=== STEP 1: button shape ===')
  console.log(JSON.stringify(step1, null, 2))
  await page.screenshot({ path: process.env.TEMP + '\\edge-ma-1.png' })

  // STEP 4: click → rollback → navigation.
  const from = await page.evaluate(() => JSON.parse(localStorage.getItem('dsh.sessions.current') ?? 'null')?.sessionId)
  await page.evaluate(() => {
    document.querySelector('[data-dsh-rollback-message-action]')?.click()
  })
  console.log('button clicked; waiting for rollback navigation...')
  let nav = { changed: false }
  for (let i = 0; i < 30; i++) {
    await sleep(2_000)
    const now = await page.evaluate(() => JSON.parse(localStorage.getItem('dsh.sessions.current') ?? 'null')?.sessionId)
    if (now !== from) { nav = { changed: true, to: now }; break }
  }
  console.log('rollback navigation:', JSON.stringify(nav))
  await sleep(6_000)
  const fold = await page.evaluate(() => {
    const strip = [...document.querySelectorAll('[role="group"]')]
      .find(g => g.getAttribute('aria-label') === '可撤回的回滚')
    return strip?.textContent?.trim().slice(0, 60) ?? null
  })
  console.log('revoke fold after rollback:', fold)
  await page.screenshot({ path: process.env.TEMP + '\\edge-ma-2.png' })

  // STEP 5: revoke → restored session → button back.
  if (fold !== null) {
    const child = await page.evaluate(() => JSON.parse(localStorage.getItem('dsh.sessions.current') ?? 'null')?.sessionId)
    await page.evaluate(() => {
      const strip = [...document.querySelectorAll('[role="group"]')]
        .find(g => g.getAttribute('aria-label') === '可撤回的回滚')
      const btn = strip === undefined ? undefined : [...strip.querySelectorAll('button')]
        .find(b => b.textContent?.includes('撤回回滚'))
      btn?.click()
    })
    console.log('revoke clicked; waiting for restore navigation...')
    let nav2 = { changed: false }
    for (let i = 0; i < 30; i++) {
      await sleep(2_000)
      const now = await page.evaluate(() => JSON.parse(localStorage.getItem('dsh.sessions.current') ?? 'null')?.sessionId)
      if (now !== child) { nav2 = { changed: true, to: now }; break }
    }
    console.log('revoke navigation:', JSON.stringify(nav2))
    await sleep(8_000)
    const restored = await page.evaluate(() => ({
      buttons: document.querySelectorAll('[data-dsh-rollback-message-action]').length,
      headerButton: [...document.querySelectorAll('button')].some(b => b.getAttribute('aria-label') === '回滚到此消息之前'),
      trailBars: document.querySelectorAll('[data-dsh-trailfold]').length,
    }))
    console.log('=== STEP 5: restored session ===')
    console.log(JSON.stringify(restored, null, 2))
    await page.screenshot({ path: process.env.TEMP + '\\edge-ma-3.png' })
  }
}

await browser.close()
console.log('Done.')
