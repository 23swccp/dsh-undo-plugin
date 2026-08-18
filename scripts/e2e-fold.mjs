/** Fold revoke e2e with timings: prompt -> rollback -> revoke, polling navigation. */

import puppeteer from 'puppeteer-core'

const URL = process.env.DSH_WEB_URL ?? 'http://127.0.0.1:3080'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  defaultViewport: { width: 1440, height: 900 },
  args: ['--no-first-run', '--disable-infobars'],
})
const page = await browser.newPage()
page.on('console', msg => {
  const text = msg.text()
  if (msg.type() === 'error' || text.includes('rollback') || text.includes('undo')) {
    console.log(`[console.${msg.type()}] ${text.slice(0, 200)}`)
  }
})
page.on('pageerror', err => console.log(`[pageerror] ${err.message.slice(0, 200)}`))

const currentId = () => page.evaluate(() => {
  try {
    const raw = localStorage.getItem('dsh.sessions.current')
    if (raw === null) return null
    return JSON.parse(raw).sessionId ?? null
  } catch { return null }
})
const foldState = () => page.evaluate(() => {
  const group = [...document.querySelectorAll('[role="group"]')]
    .find(g => g.getAttribute('aria-label') === '可撤回的回滚')
  if (group === undefined) return { present: false }
  return { present: true, groupText: group.textContent?.trim().slice(0, 80) ?? null }
})
const clickHeaderRollback = () => page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')]
    .find(b => b.getAttribute('aria-label') === '回滚到此消息之前')
  if (btn === undefined) return 'no-button'
  if (btn.disabled) return 'disabled'
  btn.click()
  return 'clicked'
})
const clickFoldRevoke = () => page.evaluate(() => {
  const group = [...document.querySelectorAll('[role="group"]')]
    .find(g => g.getAttribute('aria-label') === '可撤回的回滚')
  if (group === undefined) return 'no-group'
  const btn = [...group.querySelectorAll('button')].find(b => b.textContent?.trim().startsWith('撤回回滚'))
  if (btn === undefined) return 'no-button'
  if (btn.disabled) return 'disabled'
  btn.click()
  return 'clicked'
})

/** Poll until the current session changes away from `from`; returns elapsed seconds or timeout. */
async function waitNavigation(from, timeoutSec) {
  const start = Date.now()
  while (Date.now() - start < timeoutSec * 1000) {
    const id = await currentId()
    if (id !== from) return { changed: true, to: id, seconds: ((Date.now() - start) / 1000).toFixed(1) }
    await sleep(500)
  }
  return { changed: false, seconds: timeoutSec }
}

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 90_000 })
await sleep(6_000)
const startSession = await currentId()
console.log('session:', startSession)
console.log('fold before prompt:', JSON.stringify(await foldState()))

await page.click('textarea')
await page.keyboard.type(`请只回复“ok”两个字。turn=${Date.now() % 1000000}`)
await page.keyboard.press('Enter')
console.log('prompt sent')
await sleep(95_000)
console.log('fold after reply (must be absent):', JSON.stringify(await foldState()))

console.log('header rollback click:', await clickHeaderRollback())
const nav1 = await waitNavigation(startSession, 90)
console.log('rollback navigation:', JSON.stringify(nav1))
console.log('fold after rollback (must be present):', JSON.stringify(await foldState()))

console.log('fold revoke click:', await clickFoldRevoke())
const nav2 = await waitNavigation(nav1.to, 90)
console.log('revoke navigation:', JSON.stringify(nav2))
console.log('fold after revoke (must be absent):', JSON.stringify(await foldState()))

await browser.close()
