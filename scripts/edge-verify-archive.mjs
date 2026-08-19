/**
 * Archive-button verification: rollback the live session (archives it), then
 * read the delete-all button's computed style in Settings → Archive Tasks,
 * cancel the confirm, revoke the rollback, and re-check toolcard colors.
 * Usage: node scripts/edge-verify-archive.mjs
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
  args: ['--no-first-run', '--disable-infobars', '--user-data-dir=' + process.env.TEMP + '\\edge-arch-' + Date.now()],
})
const page = await browser.newPage()
page.on('pageerror', err => console.log(`[pageerror] ${err.message.slice(0, 200)}`))
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 90_000 })
await sleep(7_000)

await page.evaluate(() => {
  [...document.querySelectorAll('div[role="treeitem"]')]
    .find(r => r.textContent?.includes('PowerShell'))?.click()
})
await sleep(9_000)

// Rollback via header button → archives this session, navigates to child.
const clicked = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')]
    .find(b => b.getAttribute('aria-label') === '回滚到此消息之前')
  if (btn === undefined || btn.disabled) return false
  btn.click()
  return true
})
console.log('rollback clicked:', clicked)
await sleep(15_000)

// Settings → 归档任务
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')]
    .find(b => b.getAttribute('aria-haspopup') === 'dialog' && b.textContent?.includes('设置'))?.click()
})
await sleep(3_000)
await page.evaluate(() => {
  ;[...document.querySelectorAll('[role="dialog"] button')]
    .find(b => b.textContent?.includes('归档任务'))?.click()
})
await sleep(7_000)

const style = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === '全部删除')
  if (btn === undefined) return { button: false }
  const cs = getComputedStyle(btn)
  // Click it to reveal the inline confirm pair, then read those too.
  btn.click()
  return {
    button: true,
    radius: cs.borderRadius,
    height: cs.height,
    color: cs.color,
    border: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor,
    background: cs.backgroundColor,
    fontSize: cs.fontSize,
  }
})
await sleep(1_000)
const confirmStyle = await page.evaluate(() => {
  const confirm = [...document.querySelectorAll('button')].find(b => (b.textContent ?? '').includes('永久删除'))
  const cancel = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === '取消')
  const read = el => el === undefined ? null : {
    radius: getComputedStyle(el).borderRadius,
    height: getComputedStyle(el).height,
  }
  return { confirm: read(confirm), cancel: read(cancel) }
})
console.log('=== delete-all button ===')
console.log(JSON.stringify(style, null, 2))
console.log('=== inline confirm/cancel ===')
console.log(JSON.stringify(confirmStyle))
await page.screenshot({ path: SHOT + '-5-deleteall.png' })

// Cancel, close dialog, revoke the rollback from the child session.
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find(b => b.textContent?.trim() === '取消')?.click()
})
await sleep(500)
await page.evaluate(() => {
  // Close the settings dialog by toggling the same entry button.
  ;[...document.querySelectorAll('button')]
    .find(b => b.getAttribute('aria-haspopup') === 'dialog' && b.textContent?.includes('设置'))?.click()
})
await sleep(3_000)
const revoke = await page.evaluate(() => {
  const strip = [...document.querySelectorAll('[role="group"]')]
    .find(g => g.getAttribute('aria-label') === '可撤回的回滚')
  const btn = strip === undefined ? undefined : [...strip.querySelectorAll('button')]
    .find(b => b.textContent?.includes('撤回回滚'))
  if (btn === undefined || btn.disabled) return 'missing'
  btn.click()
  return 'clicked'
})
console.log('revoke clicked:', revoke)
await sleep(15_000)

// Final: back on restored session — expand a tool row, re-check card color + bars.
await page.evaluate(() => {
  ;[...document.querySelectorAll('div[role="treeitem"]')]
    .find(r => r.textContent?.includes('PowerShell'))?.click()
})
await sleep(9_000)
const final = await page.evaluate(() => {
  const bars = document.querySelectorAll('[data-dsh-trailfold]').length
  const row = document.querySelector('[data-tool="pwsh"] [aria-expanded], [data-tool] [aria-expanded]')
  row?.click()
  const card = document.querySelector('[data-terminal]')
  return {
    bars,
    pwshCardBg: card === null ? null : getComputedStyle(card).backgroundColor,
    rollbackButton: [...document.querySelectorAll('button')].some(b => b.getAttribute('aria-label') === '回滚到此消息之前'),
  }
})
console.log('=== final (restored session) ===')
console.log(JSON.stringify(final, null, 2))
await page.screenshot({ path: SHOT + '-6-restored.png' })

await browser.close()
console.log('Done.')
