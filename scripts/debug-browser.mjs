/** Click the session tree row (with ready rollback point) and check header button. */

import puppeteer from 'puppeteer-core'

const URL = process.env.DSH_WEB_URL ?? 'http://127.0.0.1:3080'
const CHROME = process.env.CHROME
  ?? (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : '/usr/bin/google-chrome')
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
  if (text.includes('Failed to load') || msg.type() === 'error') console.log(`[console.${msg.type()}] ${text}`)
})
page.on('pageerror', err => console.log(`[pageerror] ${err.message}`))

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 90_000 })
await sleep(6_000)

const clicked = await page.evaluate(() => {
  const row = [...document.querySelectorAll('div[role="treeitem"]')]
    .find(r => r.textContent?.includes('请只回复'))
  row?.click()
  return row !== undefined
})
console.log('session row clicked:', clicked)
await sleep(6_000)

const check = await page.evaluate(() => {
  const rollbackBtn = [...document.querySelectorAll('button')]
    .find(b => b.getAttribute('aria-label') === '回滚到此消息之前')
  const textarea = document.querySelector('textarea')
  return {
    hasRollbackButton: rollbackBtn !== undefined,
    title: rollbackBtn?.getAttribute('title') ?? null,
    inConversation: textarea !== null,
    bodyTail: document.body.innerText.slice(-400),
  }
})
console.log('=== HEADER CHECK ===')
console.log(JSON.stringify({ hasRollbackButton: check.hasRollbackButton, title: check.title, inConversation: check.inConversation }, null, 2))
console.log('=== BODY TAIL ===')
console.log(check.bodyTail)

await browser.close()
